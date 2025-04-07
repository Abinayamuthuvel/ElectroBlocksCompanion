import { app, BrowserWindow, Tray, Menu, dialog, shell } from "electron";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { SerialPort } from "serialport";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow, tray;

const startExpressServer = () => {
  const expressApp = express();

  const staticPath = path.join(__dirname, "ElectroBlocks", "build");
  expressApp.use(express.static(staticPath));

  expressApp.get("/ports", async (req, res) => {
    try {
      const ports = await SerialPort.list();
      res.json(
        ports.map(port => ({
          path: port.path,
          manufacturer: port.manufacturer || "Unknown",
          serialNumber: port.serialNumber || "N/A",
          vendorId: port.vendorId || "N/A",
          productId: port.productId || "N/A",
          pnpId: port.pnpId || "N/A",
        }))
      );
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  expressApp.listen(4000, () => console.log("Server running on port 4000"));
};

const updatePortsMenu = async () => {
  const availablePorts = await SerialPort.list();
  const portsSubmenu = availablePorts.length
    ? availablePorts.map(port => ({
        label: port.path,
        click: () =>
          dialog.showMessageBox({
            type: "info",
            title: "Port Info",
            message: JSON.stringify(
              {
                Path: port.path,
                Manufacturer: port.manufacturer || "Unknown",
                "Serial Number": port.serialNumber || "N/A",
                "Vendor ID": port.vendorId || "N/A",
                "Product ID": port.productId || "N/A",
                "PnP ID": port.pnpId || "N/A",
              },
              null,
              2
            ),
          }),
      }))
    : [{ label: "No ports available", enabled: false }];

  portsSubmenu.push(
    { type: "separator" },
    { label: "Refresh Ports", click: updatePortsMenu },
    {
      label: "View Ports Online",
      click: () => shell.openExternal("http://localhost:4000/ports"),
    }
  );
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ label: "Ports", submenu: portsSubmenu }])
  );
};

const createWindow = async () => {
  if (mainWindow) return mainWindow.show();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load local server (localhost) inside Electron window
  mainWindow.loadURL("http://localhost:4000").catch(err => {
    console.error("Failed to load localhost:4000:", err);
  });

  mainWindow.on("closed", () => (mainWindow = null));
  await updatePortsMenu();
};

app.whenReady().then(() => {
  tray = new Tray(path.join(__dirname, "icon.png"));
  tray.setToolTip("ElectroBlocks Tray App");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open ElectroBlocks", click: createWindow },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ])
  );
  tray.on("click", createWindow);
  startExpressServer();
  updatePortsMenu();
});

app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
