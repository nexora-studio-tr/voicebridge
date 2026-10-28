using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Windows.Forms;
using System.Collections.Generic;
using System.Web.Script.Serialization;

// .NET Framework 4.8 is supplied by supported Windows installations. No SDK at runtime.
internal static class VoiceBridgeLauncher {
    private static bool Matches(string file, string digest) {
        using (var sha = SHA256.Create())
        using (var input = File.OpenRead(file))
            return BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant() == digest;
    }
    [STAThread]
    private static int Main(string[] args) {
        bool headless = Array.IndexOf(args, "--headless") >= 0;
        string root = AppDomain.CurrentDomain.BaseDirectory;
        try {
            if (!Environment.Is64BitOperatingSystem) throw new Exception("WINDOWS_X64_REQUIRED");
            string node = Path.Combine(root, "runtime", "node.exe");
            string manifest = Path.Combine(root, "PACKAGE_MANIFEST.json");
            if (!Matches(node, PackageIdentity.NodeSha256) || !Matches(manifest, PackageIdentity.ManifestSha256))
                throw new Exception("PACKAGE_INTEGRITY");
            var serializer = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
            var files = serializer.Deserialize<Dictionary<string,string>>(File.ReadAllText(manifest));
            foreach (var entry in files) {
                string file = Path.GetFullPath(Path.Combine(root, entry.Key.Replace('/', Path.DirectorySeparatorChar)));
                if (!file.StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    throw new Exception("PACKAGE_INTEGRITY");
                string current = file;
                while (current.Length > root.TrimEnd(Path.DirectorySeparatorChar).Length) {
                    if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new Exception("PACKAGE_INTEGRITY");
                    current = Path.GetDirectoryName(current);
                }
                if (!Matches(file, entry.Value)) throw new Exception("PACKAGE_INTEGRITY");
            }
            // Pin the bootstrap before executing any bundled JavaScript.
            string bootstrap = Path.Combine(root, "app", "dist", "launcher", "main.js");
            if (!Matches(bootstrap, PackageIdentity.BootstrapSha256)) throw new Exception("PACKAGE_INTEGRITY");
            var start = new ProcessStartInfo(node, "\"" + bootstrap + "\"") {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true
            };
            start.EnvironmentVariables.Clear();
            foreach (string key in new[] {"SystemRoot","WINDIR","TEMP","TMP","LOCALAPPDATA","USERPROFILE","COMSPEC","PATHEXT"}) {
                string value = Environment.GetEnvironmentVariable(key);
                if (value != null) start.EnvironmentVariables[key] = value;
            }
            start.EnvironmentVariables["PATH"] = Path.GetDirectoryName(node) + ";" + Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32");
            using (var child = Process.Start(start)) {
                child.ErrorDataReceived += (sender, line) => { /* No host credentials or raw trace logging. */ };
                child.BeginErrorReadLine();
                var handshake = child.StandardOutput.ReadLineAsync();
                if (!handshake.Wait(30000)) {
                    if (!child.HasExited) child.Kill();
                    throw new Exception("LAUNCHER_START_TIMEOUT");
                }
                string ready = handshake.Result;
                Uri uri;
                if (ready == null || !ready.StartsWith("READY ", StringComparison.Ordinal) ||
                    !Uri.TryCreate(ready.Substring(6), UriKind.Absolute, out uri) || uri.Scheme != "http" ||
                    uri.Host != "127.0.0.1" || uri.AbsolutePath != "/install") {
                    if (!child.HasExited) child.Kill();
                    throw new Exception("LAUNCHER_START_FAILED");
                }
                if (!headless) Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
                child.WaitForExit();
                return child.ExitCode;
            }
        } catch {
            if (!headless) MessageBox.Show(
                "VoiceBridge başlatılamadı. ZIP dosyasını tamamen ayıkla ve yayımlanan SHA-256 değerini kontrol et. Ayrıntılar: docs/WINDOWS.tr.md\n\n" +
                "VoiceBridge could not start. Fully extract the ZIP and verify its published SHA-256 checksum. See docs/WINDOWS.md.",
                "VoiceBridge", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
