const express = require("express");
const fs = require("fs");
const path = require("path");
const ytdlp = require("yt-dlp-exec");

const app = express();
app.use(express.json());

const DOWNLOAD_DIR = path.join(__dirname, "downloads");

// Ensure downloads folder exists
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR);
}

/**
 * Auto-delete file after a delay
 * Default: 10 minutes (600000 ms)
 */
function scheduleDelete(filePath, delay = 10 * 60 * 1000) {
    setTimeout(() => {
        if (fs.existsSync(filePath)) {
            fs.unlink(filePath, (err) => {
                if (err) console.error("Failed to delete file:", err);
            });
        }
    }, delay);
}

/**
 * POST /download
 * Body: { url: "YouTube URL" }
 * Returns: { download_url: "...", expires_in_minutes: 10 }
 */
app.post("/download", async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: "URL is required" });
    }

    const outputTemplate = path.join(DOWNLOAD_DIR, "%(title)s.%(ext)s");

    try {
        await ytdlp(url, {
            format: "bv*+ba/b",
            mergeOutputFormat: "mp4",
            output: outputTemplate,
            noPlaylist: true,
        });

        // Find the latest merged MP4 file
        const files = fs
            .readdirSync(DOWNLOAD_DIR)
            .filter((f) => f.endsWith(".mp4"));

        if (files.length === 0) {
            return res.status(500).json({ error: "No output file found" });
        }

        const fileName = files[files.length - 1];
        const filePath = path.join(DOWNLOAD_DIR, fileName);

        // Schedule auto-delete
        scheduleDelete(filePath);

        // Return download link
        return res.json({
            download_url: `/file/${encodeURIComponent(fileName)}`,
            expires_in_minutes: 10,
        });
    } catch (err) {
        return res.status(500).json({ error: "Download failed", details: err.message });
    }
});

/**
 * GET /file/:name
 * Serves the merged video
 */
app.get("/file/:name", (req, res) => {
    const fileName = req.params.name;
    const filePath = path.join(DOWNLOAD_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File expired or not found" });
    }

    res.download(filePath);
});

/**
 * Health check
 */
app.get("/", (req, res) => {
    res.send("Video Downloader API is running 🚀");
});

// Use Render-assigned PORT or fallback to 5000 for local testing
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
