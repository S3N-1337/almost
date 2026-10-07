# Простой локальный веб-сервер для теста игры. Ничего устанавливать не нужно.
# Запуск: двойной клик по start.bat. Остановить — закрыть окно.

param([int]$Port = 8080)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$code = @'
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Collections.Generic;

public static class MiniServer {
    static string Root;
    static Dictionary<string, string> Types = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
        {".html", "text/html; charset=utf-8"}, {".htm", "text/html; charset=utf-8"},
        {".js", "application/javascript; charset=utf-8"}, {".css", "text/css; charset=utf-8"},
        {".json", "application/json; charset=utf-8"}, {".txt", "text/plain; charset=utf-8"},
        {".md", "text/plain; charset=utf-8"}, {".png", "image/png"}, {".jpg", "image/jpeg"},
        {".jpeg", "image/jpeg"}, {".gif", "image/gif"}, {".svg", "image/svg+xml"},
        {".ico", "image/x-icon"}, {".webp", "image/webp"}, {".mp3", "audio/mpeg"},
        {".wav", "audio/wav"}, {".ogg", "audio/ogg"}, {".woff2", "font/woff2"}
    };

    public static TcpListener Start(string root, int port) {
        Root = Path.GetFullPath(root).TrimEnd('\\') + "\\";
        TcpListener l = new TcpListener(IPAddress.Any, port);
        l.Start();
        return l;
    }

    public static void Loop(TcpListener l) {
        while (true) {
            TcpClient c = l.AcceptTcpClient();
            ThreadPool.QueueUserWorkItem(Handle, c);
        }
    }

    static void Handle(object o) {
        TcpClient c = (TcpClient)o;
        try {
            c.ReceiveTimeout = 5000;
            c.SendTimeout = 10000;
            NetworkStream s = c.GetStream();
            StreamReader r = new StreamReader(s, Encoding.ASCII);
            string line = r.ReadLine();
            if (line == null) return;
            string h;
            while (!string.IsNullOrEmpty(h = r.ReadLine())) { }
            string[] parts = line.Split(' ');
            if (parts.Length < 2) return;
            string method = parts[0];
            string url = parts[1];
            int q = url.IndexOf('?');
            if (q >= 0) url = url.Substring(0, q);
            url = Uri.UnescapeDataString(url);
            if (url.EndsWith("/")) url += "index.html";
            string full = Path.GetFullPath(Path.Combine(Root, url.TrimStart('/').Replace('/', '\\')));
            int code = 200;
            byte[] body;
            string type;
            if (!full.StartsWith(Root, StringComparison.OrdinalIgnoreCase) || !File.Exists(full)) {
                code = 404;
                body = Encoding.UTF8.GetBytes("404 Not Found");
                type = "text/plain; charset=utf-8";
            } else {
                body = File.ReadAllBytes(full);
                if (!Types.TryGetValue(Path.GetExtension(full), out type)) type = "application/octet-stream";
            }
            string head = "HTTP/1.1 " + code + (code == 200 ? " OK" : " Not Found") + "\r\n" +
                          "Content-Type: " + type + "\r\n" +
                          "Content-Length: " + body.Length + "\r\n" +
                          "Cache-Control: no-store\r\n" +
                          "Connection: close\r\n\r\n";
            byte[] hb = Encoding.ASCII.GetBytes(head);
            s.Write(hb, 0, hb.Length);
            if (method != "HEAD") s.Write(body, 0, body.Length);
            s.Flush();
            Console.WriteLine(DateTime.Now.ToString("HH:mm:ss") + "  " + code + "  " + url);
        } catch (Exception) {
        } finally {
            c.Close();
        }
    }
}
'@

Add-Type -TypeDefinition $code -Language CSharp

$listener = $null
foreach ($p in $Port..($Port + 10)) {
    try { $listener = [MiniServer]::Start($root, $p); $Port = $p; break } catch { }
}
if ($null -eq $listener) {
    Write-Host "Не удалось занять порт $Port-$($Port + 10). Закройте другие серверы и попробуйте снова." -ForegroundColor Red
    exit 1
}

$ips = @()
try {
    $ips = @(Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        ForEach-Object { $_.IPAddress })
} catch { }
# Домашний Wi-Fi почти всегда 192.168.x.x или 10.x.x.x — ставим такие адреса первыми
function IpRank([string]$ip) {
    if ($ip -like '192.168.*') { return 0 }
    if ($ip -like '10.*') { return 1 }
    if ($ip -match '^172\.(1[6-9]|2[0-9]|3[01])\.') { return 2 }
    return 3
}
$ips = @($ips | Sort-Object { IpRank $_ })

Write-Host ""
Write-Host "  ============================================" -ForegroundColor DarkCyan
Write-Host "   ALMOST запущена!" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  На этом компьютере:" -ForegroundColor Gray
Write-Host "     http://localhost:$Port" -ForegroundColor Cyan
Write-Host ""
if ($ips.Count -gt 0) {
    Write-Host "  С телефона (телефон в том же Wi-Fi):" -ForegroundColor Gray
    Write-Host "     http://$($ips[0]):$Port" -ForegroundColor Yellow
    if ($ips.Count -gt 1) {
        Write-Host ""
        Write-Host "  Если не открывается — попробуйте другие адреса этого компьютера:" -ForegroundColor DarkGray
        foreach ($ip in ($ips | Select-Object -Skip 1)) { Write-Host "     http://${ip}:$Port" -ForegroundColor DarkYellow }
    }
}
Write-Host ""
Write-Host "  Проверка уровней:  http://localhost:$Port/tools/check.html" -ForegroundColor Gray
Write-Host ""
Write-Host "  Чтобы остановить сервер — просто закройте это окно." -ForegroundColor Gray
Write-Host ""

if (-not $env:NO_BROWSER) { Start-Process "http://localhost:$Port" }

[MiniServer]::Loop($listener)
