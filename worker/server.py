"""Loopback HTTP transport; never logs request content, audio or credentials."""
import hmac, json, os, sys, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from engine import Engine

if hasattr(sys.stdout,'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
root=Path(os.environ.get('VOICEBRIDGE_MODELS',str(Path(__file__).resolve().parents[1]/'.voicebridge/models')))
secret=os.environ.get('VOICEBRIDGE_WORKER_TOKEN','')
if len(secret)<32: raise RuntimeError('VOICEBRIDGE_WORKER_TOKEN must be configured by the supervisor')
engine=Engine(root)
slots=threading.BoundedSemaphore(2)

class Handler(BaseHTTPRequestHandler):
    server_version='VoiceBridgeWorker/0.1'
    def setup(self):
        super().setup(); self.connection.settimeout(15)
    def log_message(self,*args): pass
    def reply(self,status,data):
        raw=json.dumps(data,ensure_ascii=True).encode()
        try:
            self.send_response(status); self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)))
            self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(raw)
        except (BrokenPipeError,ConnectionResetError,TimeoutError):pass
    def authorized(self):
        return not self.headers.get('Origin') and hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+secret)
    def do_GET(self):
        if not self.authorized():return self.reply(401,{'error':'UNAUTHORIZED'})
        if self.path!='/healthz':return self.reply(404,{'error':'NOT_FOUND'})
        self.reply(200,engine.status())
    def do_POST(self):
        if not self.authorized():return self.reply(401,{'error':'UNAUTHORIZED'})
        if self.headers.get('Content-Type','').split(';')[0]!='application/json':return self.reply(415,{'error':'JSON_REQUIRED'})
        try:length=int(self.headers.get('Content-Length','0'))
        except ValueError:return self.reply(400,{'error':'INVALID_LENGTH'})
        if not 0<length<=3*1024*1024:return self.reply(413,{'error':'BODY_LIMIT'})
        if not slots.acquire(blocking=False):return self.reply(429,{'error':'WORKER_BUSY'})
        try:
            payload=json.loads(self.rfile.read(length))
            if not isinstance(payload,dict):raise ValueError('INVALID_PAYLOAD')
            result=engine.dispatch(self.path.lstrip('/'),payload)
            self.reply(200,result)
        except (ValueError,TypeError,KeyError):self.reply(400,{'error':'INVALID_INFERENCE_INPUT'})
        except FileNotFoundError:self.reply(503,{'error':'MODELS_NOT_INSTALLED'})
        except Exception as e:
            print(json.dumps({'event':'inference_error','kind':type(e).__name__}),flush=True)
            self.reply(503,{'error':'LOCAL_INFERENCE_FAILED'})
        finally:slots.release()

port=int(os.environ.get('VOICEBRIDGE_WORKER_PORT','4351'))
if not 1024<=port<=65535:raise RuntimeError('Invalid worker port')
server=ThreadingHTTPServer(('127.0.0.1',port),Handler);server.daemon_threads=True
print(json.dumps({'event':'worker_ready','port':port,'modelsReady':engine.status()['ready']}),flush=True)
try:server.serve_forever()
except KeyboardInterrupt:pass
finally:server.server_close()
