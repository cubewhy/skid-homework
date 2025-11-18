import { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.skid.homework",
  appName: "Skid Homework",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  plugins: {
    Camera: {
      saveToGallery: false,
    },
  },
};

export default config;
