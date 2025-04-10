import { app, Tray, Menu, dialog, shell } from "electron";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { SerialPort } from "serialport";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let tray;

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
          productId: port.productId || "N/A"
        }))
      );
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  expressApp.get("*", (req, res) => {
    const indexPath = path.join(staticPath, "index.html");
    fs.readFile(indexPath, "utf8", (err, data) => {
      if (err) {
        res.status(500).send("Could not load app");
      } else {
        res.send(data);
      }
    });
  });

  expressApp.listen(4000);
};

const updatePortsMenu = async () => {
  const ports = await SerialPort.list();

  const portItems = ports.length
    ? ports.map(port => ({
        label: `${port.path} (${port.manufacturer || "Unknown"})`,
        click: () => {
          dialog.showMessageBox({
            type: "info",
            title: "Port Info",
            message: `Path: ${port.path}\nManufacturer: ${port.manufacturer || "Unknown"}\nSerial Number: ${port.serialNumber || "N/A"}\nVendor ID: ${port.vendorId || "N/A"}\nProduct ID: ${port.productId || "N/A"}`
          });
        }
      }))
    : [{ label: "No ports available", enabled: false }];

  portItems.push(
    { type: "separator" },
    { label: "Refresh Ports", click: updatePortsMenu },
    { label: "View Ports (JSON)", click: () => shell.openExternal("http://localhost:4000/ports") }
  );

  const contextMenu = Menu.buildFromTemplate([
    { label: "Ports", submenu: portItems },
    { type: "separator" },
    { label: "Open ElectroBlocks", click: () => shell.openExternal("http://localhost:4000") },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() }
  ]);

  tray.setContextMenu(contextMenu);
};

app.whenReady().then(() => {
  tray = new Tray(path.join(__dirname, "icon.png"));
  tray.setToolTip("ElectroBlocks Tray App");
  tray.on("click", () => shell.openExternal("http://localhost:4000"));
  startExpressServer();
  updatePortsMenu();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
