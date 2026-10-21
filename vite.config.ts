import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
	server: {
		host: "0.0.0.0",
		allowedHosts: true,
	},
	plugins: [react(), cloudflare()],
});
