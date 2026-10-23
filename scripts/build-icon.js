import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createEngine } from "../src/index.js";

const source = await readFile(new URL("../branding/icon.scad", import.meta.url), "utf8");
const three = await readFile(new URL("../node_modules/three/build/three.module.js", import.meta.url), "utf8");
const threeCore = await readFile(new URL("../node_modules/three/build/three.core.js", import.meta.url), "utf8");
const sizes = [16, 32, 48, 64, 128, 256, 512];
const engine = await createEngine();
let result, browser;
try {
	result = await engine.compile({ mode: "preview", files: { "icon.scad": source }, entry: "icon.scad" });
	assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
	assert.equal(result.volume, 6912);
	assert.deepEqual(result.bounds, [[-12, -12, -12], [12, 12, 12]]);
	const mesh = result.getMesh();
	const colors = [...new Set(Object.values(result.materials).map(style => style.appearance.c))];
	assert.equal(colors.length, 1, "The icon renderer expects a single authored color");
	assert.equal(typeof colors[0], "string");
	browser = await chromium.launch();
	const page = await browser.newPage();
	await page.route("**/*", route => {
		const url = route.request().url();
		if (url === "http://icon.local/") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>OpenSCAD.js icon renderer</title>" });
		if (url === "http://icon.local/three.js") return route.fulfill({ contentType: "text/javascript", body: three });
		if (url === "http://icon.local/three.core.js") return route.fulfill({ contentType: "text/javascript", body: threeCore });
		throw new Error(`Unexpected icon renderer request: ${url}`);
	});
	await page.goto("http://icon.local/");
	const images = await page.evaluate(async ({ mesh, sizes, color }) => {
		const THREE = await import("/three.js");
		const scene = new THREE.Scene();
		const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
		renderer.setSize(2048, 2048);
		renderer.setClearColor(0, 0);
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		const geometry = new THREE.BufferGeometry();
		const positions = [];
		for (let index = 0; index < mesh.vertices.length; index += mesh.numProp) positions.push(...mesh.vertices.slice(index, index + 3));
		geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
		geometry.setIndex(mesh.triangles);
		geometry.computeVertexNormals();
		const material = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true });
		const model = new THREE.Mesh(geometry, material);
		model.castShadow = true; model.receiveShadow = true;
		scene.add(model);
		scene.add(new THREE.AmbientLight("#dceeff", 0.25));
		const light = new THREE.DirectionalLight("#ffffff", 3.2);
		light.position.set(-30, -45, 65);
		light.castShadow = true;
		light.shadow.mapSize.set(2048, 2048);
		Object.assign(light.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 180 });
		light.shadow.bias = -0.00015;
		light.shadow.normalBias = 0.03;
		scene.add(light);
		const fill = new THREE.DirectionalLight("#b8d9ff", 1.1);
		fill.position.set(55, -10, 20);
		fill.castShadow = true;
		fill.shadow.mapSize.set(2048, 2048);
		Object.assign(fill.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 180 });
		fill.shadow.bias = -0.00015;
		fill.shadow.normalBias = 0.03;
		scene.add(fill);
		const camera = new THREE.OrthographicCamera(-23, 23, 23, -23, 0.1, 200);
		camera.up.set(0, 0, 1);
		camera.position.set(48, -64, 48);
		camera.lookAt(0, 0, 0);
		renderer.render(scene, camera);
		const images = sizes.map(size => {
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = size;
			const context = canvas.getContext("2d");
			context.imageSmoothingEnabled = true;
			context.imageSmoothingQuality = "high";
			context.drawImage(renderer.domElement, 0, 0, size, size);
			const pixels = context.getImageData(0, 0, size, size).data;
			let opaque = 0, blue = 0, transparent = 0, dark = 0;
			for (let index = 0; index < pixels.length; index += 4) {
				if (pixels[index + 3] > 240) {
					opaque++;
					if (pixels[index + 2] > pixels[index] * 1.3) blue++;
					if (pixels[index + 2] < 120) dark++;
				} else if (pixels[index + 3] === 0) transparent++;
			}
			const brightness = point => {
				const projected = new THREE.Vector3(...point).project(camera);
				const x = Math.floor((projected.x + 1) * size / 2);
				const y = Math.floor((1 - projected.y) * size / 2);
				const index = (y * size + x) * 4;
				return (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
			};
			const tunnelContrast = [
				brightness([9, -12, 0]) - brightness([0, -12, 0]),
				brightness([12, 9, 0]) - brightness([12, 0, 3]),
				brightness([9, 0, 12]) - brightness([0, 0, 12]),
			];
			return { size, png: canvas.toDataURL("image/png").split(",")[1], opaque, blue, transparent, dark, tunnelContrast };
		});
		geometry.dispose(); material.dispose(); renderer.dispose();
		return images;
	}, { mesh: { numProp: mesh.numProp, vertices: Array.from(mesh.vertProperties), triangles: Array.from(mesh.triVerts) }, sizes, color: colors[0] });
	for (const { size, png, opaque, blue, transparent, dark, tunnelContrast } of images) {
		assert.ok(opaque > size * size * 0.25, `${size}px icon must contain substantial solid geometry`);
		assert.ok(blue > opaque * 0.8, `${size}px icon must read as blue`);
		assert.ok(transparent > size * size * 0.25, `${size}px icon must retain transparent padding`);
		assert.ok(dark > 0, `${size}px icon must retain visible tunnel shading`);
		assert.ok(tunnelContrast.every(contrast => Math.abs(contrast) > 15), `${size}px icon must distinguish all three tunnels from their outer faces: ${tunnelContrast}`);
		await writeFile(new URL(`../branding/icon-${size}.png`, import.meta.url), Buffer.from(png, "base64"));
		console.log(`Generated ${size}px icon: ${opaque} opaque pixels, ${dark} dark tunnel pixels`);
	}
	console.log(`Compiled branding/icon.scad with OpenSCAD.js: volume ${result.volume} mm^3`);
} finally {
	await browser?.close();
	result?.dispose?.();
	engine.dispose();
}
