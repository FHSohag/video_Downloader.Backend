const express = require("express");
const cors = require("cors");
const { exec, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// Enable CORS
app.use(cors({ origin: "*" }));

const DOWNLOAD_DIR = path.join(__dirname, "downloads");
const BIN_DIR = path.join(__dirname, "bin");
const YTDLP_PATH = path.join(BIN_DIR, "yt-dlp");
const FFMPEG_PATH = path.join(BIN_DIR, "ffmpeg");

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

// Make binaries executable
try {
    execSync(`chmod +x "${YTDLP_PATH}"`);
    execSync(`chmod +x "${FFMPEG_PATH}"`);
    console.log("yt-dlp and ffmpeg set as executable ✅");
} catch (err) {
    console.error("Failed to chmod binaries:", err);
}

// Auto-delete files after 10 minutes
function scheduleDelete(filePath, delay = 10 * 60 * 1000) {
    setTimeout(() => {
        if (fs.existsSync(filePath)) fs.unlink(filePath, () => { });
    }, delay);
}

// -------------------- CHECK AVAILABLE FORMATS --------------------
app.post("/check", (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    const command = `"${YTDLP_PATH}" --dump-json "${url}"`;

    exec(command, { maxBuffer: 1024 * 1024 * 15 }, (error, stdout, stderr) => {
        if (error) {
            console.error("yt-dlp check error:", stderr || error.message);
            return res.status(500).json({
                error: "Failed to fetch formats",
                details: stderr || error.message,
            });
        }

        try {
            const info = JSON.parse(stdout.trim());
            const formats = info.formats
                .filter(f => f.format_id && ["mp4", "webm"].includes(f.ext))
                .map(f => ({
                    itag: f.format_id,
                    quality: `${f.format} (${(f.filesize || f.filesize_approx) ? ((f.filesize || f.filesize_approx) / 1024 / 1024).toFixed(1) + "MB" : "N/A"})`,
                    filesize: f.filesize || f.filesize_approx,
                    ext: f.ext
                }));

            if (!formats.length) {
                return res.status(404).json({ error: "No downloadable MP4/WebM formats available for this video" });
            }

            res.json({ formats });
        } catch (err) {
            console.error("Parsing yt-dlp output failed:", err.message);
            res.status(500).json({ error: "Failed to parse yt-dlp output", details: err.message });
        }
    });
});

// -------------------- DOWNLOAD --------------------
app.post("/download", (req, res) => {
    const { url, itag } = req.body;
    if (!url || !itag) return res.status(400).json({ error: "URL and itag are required" });

    const outputTemplate = path.join(DOWNLOAD_DIR, "%(title)s.%(ext)s");

    const command = `"${YTDLP_PATH}" -f "${itag}" --ffmpeg-location "${FFMPEG_PATH}" --no-playlist -o "${outputTemplate}" "${url}"`;

    exec(command, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
        if (error) {
            console.error("yt-dlp download error:", stderr || error.message);
            return res.status(500).json({
                error: "Download failed",
                details: stderr || error.message,
            });
        }

        const files = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.endsWith(".mp4") || f.endsWith(".webm"));
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

// Serve downloaded files
app.get("/file/:name", (req, res) => {
    const filePath = path.join(DOWNLOAD_DIR, req.params.name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File expired or not found" });
    res.download(filePath);
});

// Health check
app.get("/", (_, res) => res.send("Video Downloader API is running 🚀"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
