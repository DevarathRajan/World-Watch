const { app, BrowserWindow, screen, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");

let win    = null;
let server = null;

// WM_ELECTRON_ONLY is set when server.py launches us — means Python is already
// running, so we just open the window and skip spawning it again.
const serverAlreadyRunning = process.env.WM_ELECTRON_ONLY === "1";
const PORT = process.env.WM_PORT || "9766";

app.whenReady().then(() => {

  if (!serverAlreadyRunning) {
    // npm start was called directly — start the Python server ourselves
    const python = path.join(__dirname, ".venv", "Scripts", "python.exe");
    server = spawn(python, [path.join(__dirname, "server.py")], {
      cwd: __dirname,
      env: { ...process.env, WM_ELECTRON_ONLY: "1" },
    });
    server.stdout.on("data", d => console.log("[WM Server]", d.toString().trim()));
    server.stderr.on("data", d => console.error("[WM Server]", d.toString().trim()));
  }

  // Give the server a moment to bind before opening the window
  const delay = serverAlreadyRunning ? 200 : 1500;
  setTimeout(() => {
    const { workAreaSize } = screen.getPrimaryDisplay();
    win = new BrowserWindow({
      width:  workAreaSize.width,
      height: workAreaSize.height,
      x: 0, y: 0,
      frame: false,
      backgroundColor: "#010508",
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    // Keep everything inline. YouTube embeds (webcams/broadcast) try to pop a
    // new window when clicked — deny that so they play in-app, and send any
    // genuine external link to the system browser instead of a new app window.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });

    // Adapt the dense dashboard to the screen resolution so it isn't
    // microscopic on 4K or cramped on small laptops (baseline width = 1920).
    const zoom = Math.max(0.8, Math.min(1.4, workAreaSize.width / 1920));
    win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(zoom));

    win.loadURL(`http://localhost:${PORT}`);
    win.on("closed", () => { win = null; });
  }, delay);

});

app.on("window-all-closed", () => {
  if (server) server.kill();
  app.quit();
});
