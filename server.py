import os
import re
import json
import yt_dlp
from PIL import Image
import imageio_ffmpeg
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SONGS_DIR = os.path.join(BASE_DIR, "songs")
COVERS_DIR = os.path.join(BASE_DIR, "covers")
TRACKS_JSON = os.path.join(BASE_DIR, "tracks.json")

os.makedirs(SONGS_DIR, exist_ok=True)
os.makedirs(COVERS_DIR, exist_ok=True)

# Automatically locate the ffmpeg binary from pip package
FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()

def format_duration(seconds):
    if not seconds:
        return "0:00"
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m}:{s:02d}"

def get_next_track_meta():
    tracks = []
    if os.path.exists(TRACKS_JSON):
        try:
            with open(TRACKS_JSON, "r", encoding="utf-8") as f:
                tracks = json.load(f)
        except Exception:
            tracks = []

    highest_num = 0
    for t in tracks:
        for key in ["id", "url", "cover"]:
            val = str(t.get(key, ""))
            matches = re.findall(r"(\d+)", val)
            for m in matches:
                highest_num = max(highest_num, int(m))

    next_num = highest_num + 1
    num_str = f"{next_num:02d}"

    track_id = f"trk_{num_str}"
    audio_filename = f"track{num_str}.mp3"
    cover_filename = f"track{num_str}_cover.jpg"

    return track_id, audio_filename, cover_filename, tracks

@app.route("/api/download", methods=["POST", "OPTIONS"])
def download_track():
    if request.method == "OPTIONS":
        return jsonify({"status": "ok"}), 200

    data = request.get_json() or {}
    url = data.get("url", "").strip()

    if not url:
        return jsonify({"error": "No URL provided"}), 400

    track_id, audio_filename, cover_filename, existing_tracks = get_next_track_meta()
    raw_name_no_ext = audio_filename.replace(".mp3", "")
    target_mp3_path = os.path.join(SONGS_DIR, audio_filename)
    target_cover_path = os.path.join(COVERS_DIR, cover_filename)

    ydl_opts = {
        "ffmpeg_location": FFMPEG_EXE,
        "format": "bestaudio/best",
        "outtmpl": os.path.join(SONGS_DIR, f"{raw_name_no_ext}.%(ext)s"),
        "writethumbnail": True,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }
        ],
        "quiet": False,
        "no_warnings": False,
        "http_headers": {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get("title", f"Track {track_id}")
            artist = info.get("uploader", info.get("channel", "Unknown Artist"))
            duration_sec = info.get("duration", 0)
            duration_formatted = format_duration(duration_sec)

        # Convert and move downloaded thumbnail to ./covers/trackXX_cover.jpg
        for f in os.listdir(SONGS_DIR):
            if f.startswith(raw_name_no_ext) and f.endswith((".webp", ".png", ".jpg", ".jpeg")):
                src_thumb = os.path.join(SONGS_DIR, f)
                try:
                    # Convert webp/png directly to clean JPEG
                    with Image.open(src_thumb) as img:
                        img.convert("RGB").save(target_cover_path, "JPEG", quality=90)
                    os.remove(src_thumb)
                except Exception:
                    os.rename(src_thumb, target_cover_path)
                break

        if not os.path.exists(target_mp3_path):
            return jsonify({"error": "FFmpeg failed to produce the mp3 file."}), 500

        new_entry = {
            "id": track_id,
            "title": title,
            "artist": artist,
            "album": "Single",
            "duration": duration_formatted,
            "url": f"./songs/{audio_filename}",
            "cover": f"./covers/{cover_filename}" if os.path.exists(target_cover_path) else "./icons/icon-512.png"
        }

        existing_tracks.append(new_entry)
        with open(TRACKS_JSON, "w", encoding="utf-8") as f:
            json.dump(existing_tracks, f, indent=2)

        print(f"[Success] Added: {track_id} -> {audio_filename} & {cover_filename}")
        return jsonify({"success": True, "track": new_entry})

    except Exception as e:
        print(f"[Execution Error] {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    print(f"[Bridge Active] Using FFmpeg from: {FFMPEG_EXE}")
    print("[Bridge Active] Server running on http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=True)