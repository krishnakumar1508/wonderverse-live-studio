WONDERVERSE LIVE STUDIO — SELF-HOSTED STARTER
=============================================

IMPORTANT:
- Ye website frontend ke saath backend aur FFmpeg relay bhi rakhti hai.
- Is ZIP ko apne aap public website par deploy nahi kiya gaya hai.
- Isko chalane ke liye Docker wala VPS/server chahiye; normal static hosting kaafi nahi.
- Direct MP4/M3U8 jaise accessible media URL sabse achchhe hain. YouTube watch URL aksar direct relay source nahi hota.
- Apne ya permission wale content ko hi rebroadcast karein.
- YouTube/Facebook stream keys secret rakhein.

SERVER PAR START KARNE KE STEPS
1. ZIP extract karein.
2. Server par Docker + Docker Compose install karein.
3. Is folder mein .env.example ko copy karke .env naam dein.
4. .env file mein ADMIN_PASSWORD ko ek strong, unique password se replace karein.
5. Terminal mein isi folder se chalayein:
      docker compose up -d --build
6. Browser mein kholein:
      http://SERVER-IP:8080
7. Public internet par use karne se pehle HTTPS/reverse proxy (jaise Caddy/Nginx) configure karein aur port ko secure karein.
8. Website par source URL, YouTube/Facebook server URL + keys, aur dashboard password bharein.
9. GO LIVE dabayein. Dono platform dashboards mein status verify karein.

LOCAL TEST (Docker installed ho):
- .env file banayein.
- docker compose up --build
- http://localhost:8080 open karein.

LIMITATIONS / SECURITY
- Ye starter ek single-admin control panel hai, multi-user product nahi.
- HTTPS ke bina public network par use na karein; credentials ko secure rakhein.
- Stream key fields browser storage mein save nahi hote. Keys start request ke waqt server ko bheje jaate hain.
- Server logs/process environment ko secure rakhein; VPS access sirf trusted admin ko dein.
- Source server par FFmpeg ke liye directly accessible hona chahiye. DRM, login-protected sources, and many platform watch-page URLs won't work.
- Stream start hone ka matlab platform ne ingest accept kar liya ho, ye guarantee nahi; YouTube/Facebook Live Producer mein actual live status check karein.
