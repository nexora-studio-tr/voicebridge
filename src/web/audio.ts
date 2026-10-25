import { useEffect, useRef, useState } from 'react';

/** Audio never leaves this origin. Reset discards fetched and queued speech, including in-flight fetches. */
export function usePlayback(onFailure: () => void) {
  const context = useRef<AudioContext | null>(null),
    gain = useRef<GainNode | null>(null),
    source = useRef<AudioBufferSourceNode | null>(null);
  const queue = useRef<string[]>([]),
    seen = useRef(new Set<string>()),
    generation = useRef(0),
    request = useRef<AbortController | null>(null),
    running = useRef(false),
    enabled = useRef(false);
  const [armed, setArmed] = useState(false),
    [playing, setPlaying] = useState(false),
    [volume, setVolume] = useState(80),
    [pending, setPending] = useState(0);
  function reset() {
    generation.current++;
    queue.current = [];
    seen.current.clear();
    request.current?.abort();
    source.current?.stop();
    source.current = null;
    running.current = false;
    setPlaying(false);
    setPending(0);
  }
  function disarm() {
    enabled.current = false;
    setArmed(false);
    reset();
  }
  async function pump() {
    if (running.current || !enabled.current || !context.current) return;
    const url = queue.current.shift();
    setPending(queue.current.length);
    if (!url) return;
    const epoch = generation.current;
    running.current = true;
    const abort = new AbortController();
    request.current = abort;
    try {
      const response = await fetch(url, { credentials: 'same-origin', signal: abort.signal });
      if (!response.ok) throw new Error('AUDIO_EXPIRED');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 4 * 1024 * 1024) throw new Error('AUDIO_LIMIT');
      const decoded = await context.current.decodeAudioData(bytes);
      if (epoch !== generation.current || !enabled.current) return;
      const node = context.current.createBufferSource();
      node.buffer = decoded;
      node.connect(gain.current!);
      source.current = node;
      setPlaying(true);
      await new Promise<void>((resolve) => {
        node.onended = () => resolve();
        node.start();
      });
    } catch {
      if (!abort.signal.aborted && epoch === generation.current) onFailure();
    } finally {
      if (epoch === generation.current) {
        running.current = false;
        setPlaying(false);
        source.current = null;
        void pump();
      }
    }
  }
  function enqueue(url: string) {
    if (
      !enabled.current ||
      seen.current.has(url) ||
      !/^\/api\/rooms\/[^/]+\/audio\/[^/]+$/.test(url)
    )
      return;
    seen.current.add(url);
    if (seen.current.size > 200) seen.current.delete(seen.current.values().next().value!);
    if (queue.current.length >= 3) queue.current.shift();
    queue.current.push(url);
    setPending(queue.current.length);
    void pump();
  }
  async function toggle() {
    if (enabled.current) {
      disarm();
      return;
    }
    try {
      if (!context.current) {
        context.current = new AudioContext();
        gain.current = context.current.createGain();
        gain.current.connect(context.current.destination);
      }
      await context.current.resume();
      gain.current!.gain.value = volume / 100;
      enabled.current = true;
      setArmed(true);
    } catch {
      onFailure();
    }
  }
  function changeVolume(value: number) {
    setVolume(value);
    if (gain.current) gain.current.gain.value = value / 100;
  }
  useEffect(
    () => () => {
      enabled.current = false;
      request.current?.abort();
      source.current?.stop();
      void context.current?.close();
    },
    [],
  );
  return {
    armed,
    playing,
    pending,
    volume,
    toggle,
    enqueue,
    reset,
    disarm,
    skip: () => source.current?.stop(),
    changeVolume,
  };
}
