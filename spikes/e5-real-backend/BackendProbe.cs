using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

public static class BackendProbe
{
    private static byte[] Response(int status, string reason, string body)
    {
        byte[] payload = Encoding.UTF8.GetBytes(body);
        string head = "HTTP/1.1 " + status + " " + reason + "\r\n" +
                      "Content-Type: application/json; charset=utf-8\r\n" +
                      "Content-Length: " + payload.Length + "\r\n" +
                      "Connection: close\r\n\r\n";
        byte[] prefix = Encoding.ASCII.GetBytes(head);
        byte[] all = new byte[prefix.Length + payload.Length];
        Buffer.BlockCopy(prefix, 0, all, 0, prefix.Length);
        Buffer.BlockCopy(payload, 0, all, prefix.Length, payload.Length);
        return all;
    }

    private static string ReadRequest(Stream stream, out string body)
    {
        MemoryStream bytes = new MemoryStream();
        int state = 0;
        while (bytes.Length < 65536 && state < 4)
        {
            int next = stream.ReadByte();
            if (next < 0) break;
            bytes.WriteByte((byte)next);
            if ((state == 0 || state == 2) && next == '\r') state++;
            else if ((state == 1 || state == 3) && next == '\n') state++;
            else state = next == '\r' ? 1 : 0;
        }
        string headers = Encoding.ASCII.GetString(bytes.ToArray());
        int length = 0;
        foreach (string line in headers.Split(new[] { "\r\n" }, StringSplitOptions.None))
        {
            if (line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                Int32.TryParse(line.Substring(15).Trim(), out length);
        }
        byte[] payload = new byte[length];
        int offset = 0;
        while (offset < length)
        {
            int count = stream.Read(payload, offset, length - offset);
            if (count <= 0) break;
            offset += count;
        }
        body = Encoding.UTF8.GetString(payload, 0, offset);
        return headers.Split(new[] { "\r\n" }, StringSplitOptions.None)[0];
    }

    public static int Main(string[] args)
    {
        string queuePath = args[0];
        string readyPath = args[1];
        string outsidePath = args[2];
        bool outsideReadable = false;
        try { File.ReadAllText(outsidePath); outsideReadable = true; }
        catch (Exception) { outsideReadable = false; }
        bool experimentKeyVisible = Environment.GetEnvironmentVariable("OEY_E5_EXPERIMENT_KEY") != null;

        Directory.CreateDirectory(queuePath);
        File.WriteAllText(readyPath, "ready");
        while (true)
        {
            string[] requests = Directory.GetFiles(queuePath, "*.req");
            if (requests.Length == 0)
            {
                Thread.Sleep(10);
                continue;
            }
            foreach (string requestPath in requests)
            {
                using (MemoryStream stream = new MemoryStream(File.ReadAllBytes(requestPath)))
                {
                string body;
                string requestLine = ReadRequest(stream, out body);
                string route = requestLine.Split(' ')[1];
                byte[] response;
                if (route == "/health")
                {
                    string json = "{\"ok\":true,\"outside_readable\":" +
                                  outsideReadable.ToString().ToLowerInvariant() +
                                  ",\"experiment_key_visible\":" +
                                  experimentKeyVisible.ToString().ToLowerInvariant() + "}";
                    response = Response(200, "OK", json);
                }
                else if (route == "/echo")
                {
                    response = Response(200, "OK", "{\"echo\":" + Quote(body) + "}");
                }
                else
                {
                    response = Response(404, "Not Found", "{\"error\":\"not_found\"}");
                }
                    string responsePath = Path.ChangeExtension(requestPath, ".resp");
                    string temporaryPath = responsePath + ".tmp";
                    File.WriteAllBytes(temporaryPath, response);
                    File.Move(temporaryPath, responsePath);
                    File.Delete(requestPath);
                }
            }
        }
    }

    private static string Quote(string text)
    {
        return "\"" + text.Replace("\\", "\\\\").Replace("\"", "\\\"")
                           .Replace("\r", "\\r").Replace("\n", "\\n") + "\"";
    }
}
