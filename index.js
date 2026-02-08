const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const DOWNLOAD_DIR = path.join(__dirname, "downloads");
const BIN_DIR = path.join(__dirname, "bin");
const YTDLP_PATH = path.join(BIN_DIR, "yt-dlp");
const FFMPEG_PATH = path.join(BIN_DIR, "ffmpeg");

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

function scheduleDelete(filePath, delay = 10 * 60 * 1000) {
    setTimeout(() => {
        if (fs.existsSync(filePath)) fs.unlink(filePath, () => { });
    }, delay);
}

app.post("/download", (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    const outputTemplate = path.join(DOWNLOAD_DIR, "%(title)s.%(ext)s");

    const command = `
chmod +x "${YTDLP_PATH}" "${FFMPEG_PATH}" && \
"${YTDLP_PATH}" \
-f "bv*+ba/b" \
--merge-output-format mp4 \
--ffmpeg-location "${FFMPEG_PATH}" \
--no-playlist \
-o "${outputTemplate}" \
"${url}"
`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({
                error: "Download failed",
                details: stderr || error.message,
            });
        }

        const files = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.endsWith(".mp4"));
        if (!files.length) return res.status(500).json({ error: "No output file found" });

        const fileName = files[files.length - 1];
        const filePath = path.join(DOWNLOAD_DIR, fileName);

        scheduleDelete(filePath);

        res.json({
            download_url: `/file/${encodeURIComponent(fileName)}`,
            expires_in_minutes: 10,
        });
    });
});

app.get("/file/:name", (req, res) => {
    const filePath = path.join(DOWNLOAD_DIR, req.params.name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File expired or not found" });
    res.download(filePath);
});

app.get("/", (_, res) => res.send("Video Downloader API is running 🚀"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
