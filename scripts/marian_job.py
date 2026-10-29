"""Windows-only memory/job isolation for an owned conversion child; no global settings."""
import ctypes
import sys
from ctypes import wintypes

CREATE_SUSPENDED = 0x00000004


class ThreadEntry(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('usage', wintypes.DWORD), ('threadId', wintypes.DWORD),
                ('processId', wintypes.DWORD), ('basePriority', wintypes.LONG),
                ('deltaPriority', wintypes.LONG), ('flags', wintypes.DWORD)]


class BasicLimits(ctypes.Structure):
    _fields_ = [('processTime', ctypes.c_longlong), ('jobTime', ctypes.c_longlong),
                ('flags', wintypes.DWORD), ('minWorkingSet', ctypes.c_size_t),
                ('maxWorkingSet', ctypes.c_size_t), ('activeProcesses', wintypes.DWORD),
                ('affinity', ctypes.c_size_t), ('priority', wintypes.DWORD),
                ('scheduling', wintypes.DWORD)]


class IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in
                ('readOps', 'writeOps', 'otherOps', 'readBytes', 'writeBytes', 'otherBytes')]


class ExtendedLimits(ctypes.Structure):
    _fields_ = [('basic', BasicLimits), ('io', IoCounters),
                ('processMemoryLimit', ctypes.c_size_t), ('jobMemoryLimit', ctypes.c_size_t),
                ('peakProcessMemory', ctypes.c_size_t), ('peakJobMemory', ctypes.c_size_t)]


class WindowsJob:
    """Hard private-commit limit; closing the job kills only its assigned child tree."""
    def __init__(self, memory_limit):
        if sys.platform != 'win32':
            raise ValueError('WINDOWS_JOB_REQUIRED')
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.kernel.SetInformationJobObject.restype = wintypes.BOOL
        self.kernel.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p,
                                                         wintypes.DWORD, ctypes.c_void_p]
        self.kernel.QueryInformationJobObject.restype = wintypes.BOOL
        self.kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.kernel.AssignProcessToJobObject.restype = wintypes.BOOL
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.restype = wintypes.BOOL
        self.handle = self.kernel.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = ExtendedLimits()
        # A Windows venv launcher plus its interpreter; both share one job-wide cap.
        limits.basic.flags = 0x2000 | 0x100 | 0x200 | 0x8
        limits.basic.activeProcesses = 2
        limits.processMemoryLimit = memory_limit
        limits.jobMemoryLimit = memory_limit
        if not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            error = ctypes.get_last_error()
            self.close()
            raise ctypes.WinError(error)

    def assign(self, process):
        if not self.kernel.AssignProcessToJobObject(self.handle, wintypes.HANDLE(int(process._handle))):
            raise ctypes.WinError(ctypes.get_last_error())
        self._resume_created_thread(process.pid)

    def _resume_created_thread(self, pid):
        # subprocess closes the initial thread handle. Reopen only this owned PID's thread.
        self.kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
        self.kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
        for name in ('Thread32First', 'Thread32Next'):
            function = getattr(self.kernel, name)
            function.argtypes = [wintypes.HANDLE, ctypes.POINTER(ThreadEntry)]
            function.restype = wintypes.BOOL
        self.kernel.OpenThread.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.kernel.OpenThread.restype = wintypes.HANDLE
        self.kernel.ResumeThread.argtypes = [wintypes.HANDLE]
        self.kernel.ResumeThread.restype = wintypes.DWORD
        snapshot = self.kernel.CreateToolhelp32Snapshot(0x4, 0)  # TH32CS_SNAPTHREAD
        if snapshot == wintypes.HANDLE(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        threads = []
        try:
            entry = ThreadEntry()
            entry.size = ctypes.sizeof(entry)
            present = self.kernel.Thread32First(snapshot, ctypes.byref(entry))
            while present:
                if entry.processId == pid:
                    threads.append(entry.threadId)
                present = self.kernel.Thread32Next(snapshot, ctypes.byref(entry))
        finally:
            self.kernel.CloseHandle(snapshot)
        if len(threads) != 1:
            raise ValueError('EXPECTED_ONE_SUSPENDED_THREAD')
        thread = self.kernel.OpenThread(0x2, False, threads[0])  # THREAD_SUSPEND_RESUME
        if not thread:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            if self.kernel.ResumeThread(thread) != 1:
                raise ValueError('PROCESS_NOT_CREATED_SUSPENDED')
        finally:
            self.kernel.CloseHandle(thread)

    def peak_private_bytes(self):
        limits = ExtendedLimits()
        if not self.kernel.QueryInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits), None):
            raise ctypes.WinError(ctypes.get_last_error())
        return limits.peakJobMemory

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
