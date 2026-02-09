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

// Sanitize & truncate filenames
function sanitizeFilename(name) {
    return name.replace(/[/\\?%*:|"<>]/g, "_").substring(0, 50);
}

// -------------------- CHECK AVAILABLE FORMATS --------------------
app.post("/check", (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    const command = `"${YTDLP_PATH}" --geo-bypass --no-check-certificate --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36" --dump-json "${url}"`;

    exec(command, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
        if (error) {
            console.error("yt-dlp check error:", stderr || error.message);
            return res.status(500).json({
                error: "Failed to fetch formats",
                details: stderr || error.message,
            });
        }

        try {
            const info = JSON.parse(stdout.trim());
            const videoOnly = [];
            const audioOnly = [];
            const combined = [];

            (info.formats || []).forEach(f => {
                if (!f.format_id) return;
                const item = {
                    itag: f.format_id,
                    quality: f.format,
                    ext: f.ext,
                    filesize: f.filesize || f.filesize_approx || null
                };
                if (f.vcodec !== "none" && f.acodec === "none") videoOnly.push(item);
                else if (f.vcodec === "none" && f.acodec !== "none") audioOnly.push(item);
                else if (f.vcodec !== "none" && f.acodec !== "none") combined.push(item);
            });

            if (!videoOnly.length && !audioOnly.length && !combined.length)
                return res.status(404).json({ error: "No downloadable formats found" });

            res.json({ videoOnly, audioOnly, combined });
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

    const outputTemplate = path.join(DOWNLOAD_DIR, "%(title).50s.%(ext)s"); // truncate title

    // Get info to check if format is combined or video-only
    const checkCommand = `"${YTDLP_PATH}" --dump-json "${url}"`;
    exec(checkCommand, { maxBuffer: 1024 * 1024 * 20 }, (err, stdout) => {
        if (err) return res.status(500).json({ error: "Failed to fetch video info" });

        let info;
        try { info = JSON.parse(stdout.trim()); } catch { return res.status(500).json({ error: "Failed to parse info" }); }

        const format = info.formats.find(f => f.format_id == itag);
        if (!format) return res.status(400).json({ error: "Invalid itag" });

        // Build download command
        let command = "";
        if (format.acodec !== "none" && format.vcodec !== "none") {
            // combined format
            command = `"${YTDLP_PATH}" -f "${itag}" --ffmpeg-location "${FFMPEG_PATH}" --no-playlist -o "${outputTemplate}" "${url}"`;
        } else {
            // video-only: merge with best audio
            command = `"${YTDLP_PATH}" -f "${itag}+bestaudio" --ffmpeg-location "${FFMPEG_PATH}" --merge-output-format mp4 --no-playlist -o "${outputTemplate}" "${url}"`;
        }

        exec(command, { maxBuffer: 1024 * 1024 * 50 }, handleDownload(res));
    });
});

// -------------------- DOWNLOAD HANDLER --------------------
function handleDownload(res) {
    return (error, stdout, stderr) => {
        if (error) {
            console.error("yt-dlp download error:", stderr || error.message);
            return res.status(500).json({
                error: "Download failed",
                details: stderr || error.message,
            });
        }

        // Get latest downloaded file
        const files = fs.readdirSync(DOWNLOAD_DIR)
            .filter(f => f.endsWith(".mp4") || f.endsWith(".webm"))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(DOWNLOAD_DIR, f)).mtime.getTime() }))
            .sort((a, b) => b.mtime - a.mtime);

        if (!files.length) return res.status(500).json({ error: "No output file found" });

        const fileName = files[0].name;
        const filePath = path.join(DOWNLOAD_DIR, fileName);

        scheduleDelete(filePath);

        res.json({
            download_url: `/file/${encodeURIComponent(fileName)}`,
            expires_in_minutes: 10,
        });
    };
}

// Serve files
app.get("/file/:name", (req, res) => {
    const filePath = path.join(DOWNLOAD_DIR, req.params.name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File expired or not found" });
    res.download(filePath);
});

// Health check
app.get("/", (_, res) => res.send("Video Downloader API is running 🚀"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
