# Guarded Marian conversion

[Türkçe](MARIAN-CONVERSION.tr.md) · [Verified sources](reports/MODEL-SOURCES-2026-10-29.md) · [Check-only observation](reports/quality-model-runner-2026-10-29.json)

Research preparation only. The runner and guard tests are implemented; **neither real model has been converted or evaluated**. Available RAM remains below the admission guards. The current application and model lock are unchanged. Conversion is an offline developer operation, separate from product setup.

In the configured Windows worker environment, check one direction:

```powershell
.\.venv\Scripts\python.exe scripts\convert_marian.py --direction en-tr
```

The default checks resources only. It never starts a child, creates a conversion directory, downloads weights or activates a model, even if resources pass. The recorded check-only snapshot includes source hashes and the observed blocked admission.

After the selected direction passes its RAM/disk/dependency checks, an explicit invocation can perform conversion:

```powershell
.\.venv\Scripts\python.exe scripts\convert_marian.py --direction en-tr --run
# Later, independently admitted:
.\.venv\Scripts\python.exe scripts\convert_marian.py --direction tr-en --run
```

The 2 GiB / 4 GiB available-RAM guards remain conservative admission rules, not measured model requirements. Existing archive/source files must match the pinned verification lock. Run mode requires Windows; other platforms fail without a weaker fallback. The lightweight cross-platform tests exercise admission and lifecycle logic; the native job test runs only on Windows.

The child is [created suspended](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags), attached to an owned Job Object and only then [resumed](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-resumethread). This includes the Windows virtual-environment launcher and its interpreter from their first execution. The job permits up to two OS processes for that chain, with a shared private-commit cap of 1.5 GiB / 3 GiB. A global exclusive semaphore allows one conversion at a time. Closing the job terminates only its assigned child tree; unrelated applications are never managed.

The parent monitors available RAM, disk and experiment size. It stops on unknown memory or less than 512 MiB available, less than 10 GiB free disk, the experiment's stop threshold or ten minutes. Output space is reserved before launch; monitoring stops 256 MiB below the 5 GiB working budget. This monitoring is not an OS disk quota. OMP/OpenBLAS/MKL thread requests are set to two. Private commit is not physical RSS; the report names the measured quantity explicitly.

Successful research output goes to `artifacts/marian-experiment-v1/<direction>/ct2-int8`, with source/target tokenizers, upstream README/LICENSE and conversion provenance. The runner never writes `.voicebridge/models`. It records file hashes, elapsed time and observed peak job private commit; no success is reported before the child exits successfully and expected output files exist. Existing output is never overwritten. Failures preserve the local worker log and report without promoting output. Its own semaphore is released during handled cleanup; an abrupt parent termination can leave a stale semaphore for manual inspection. Do not break another active run's lock.

Validation includes a small native child under a 64 MiB job cap: a 256 MiB allocation must raise `MemoryError`. This verifies the guard, **not real-model conversion or quality**. Conversion compatibility, output size, peak model memory, token/normalization behavior and the development quality screen remain pending. No cloud fallback, upstream-model publication, runtime version bump, reserved/audio evaluation or live Discord test is included.
