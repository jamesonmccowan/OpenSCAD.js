import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { applyView, viewportBindings } from "./camera.js";

function material(appearance = {}, kind) {
	let color = new THREE.Color("#b8ee62");
	let alpha = 1;
	const value = appearance.c;
	if (Array.isArray(value)) {
		color.setRGB(...[0, 1, 2].map((index) => THREE.MathUtils.clamp(Number.isFinite(value[index]) ? value[index] : 1, 0, 1)), THREE.SRGBColorSpace);
		alpha = value[3] ?? 1;
	} else if (typeof value === "string") {
		const hex = /^#([0-9a-f]{4}|[0-9a-f]{8})$/i.exec(value);
		if (hex) {
			const expanded = hex[1].length === 4 ? [...hex[1]].map((digit) => digit + digit).join("") : hex[1];
			color.setStyle("#" + expanded.slice(0, 6)); alpha = parseInt(expanded.slice(6), 16) / 255;
		} else if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) || Object.hasOwn(THREE.Color.NAMES, value.toLowerCase())) color.setStyle(value);
	}
	if (Number.isFinite(appearance.alpha)) alpha = appearance.alpha;
	if (kind === "background") { color.setStyle("#a3a9af"); alpha = 0.28; }
	if (kind === "debug") { color.setStyle("#ff6955"); alpha = 0.48; }
	alpha = THREE.MathUtils.clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1);
	return new THREE.MeshStandardMaterial({ color, opacity: alpha, transparent: alpha < 1, depthWrite: alpha === 1, roughness: 0.58, metalness: 0.04, flatShading: true, side: THREE.DoubleSide, polygonOffset: Boolean(kind), polygonOffsetFactor: kind ? -1 : 0, polygonOffsetUnits: kind ? -1 : 0 });
}

function objectFromMesh(mesh, styles = {}, kind) {
	const geometry = new THREE.BufferGeometry();
	const positions = new Float32Array(mesh.vertProperties.length / mesh.numProp * 3);
	for (let vertex = 0; vertex < positions.length / 3; vertex++) positions.set(mesh.vertProperties.subarray(vertex * mesh.numProp, vertex * mesh.numProp + 3), vertex * 3);
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setIndex(new THREE.BufferAttribute(mesh.triVerts, 1));
	geometry.computeVertexNormals();
	let materials;
	if (!kind && mesh.runOriginalID?.length) {
		materials = Array.from(mesh.runOriginalID, (id) => material(styles[id]?.appearance));
		mesh.runOriginalID.forEach((id, index) => geometry.addGroup(mesh.runIndex[index], mesh.runIndex[index + 1] - mesh.runIndex[index], index));
	} else {
		materials = [material({}, kind)];
		geometry.addGroup(0, mesh.triVerts.length, 0);
	}
	const object = new THREE.Mesh(geometry, materials);
	object.castShadow = !kind; object.receiveShadow = !kind;
	object.userData.scadLayer = kind ?? "solid";
	object.renderOrder = kind === "debug" ? 2 : kind === "background" ? 1 : 0;
	return object;
}

function disposeModel(model) {
	model.traverse((object) => {
		object.geometry?.dispose();
		for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) material.dispose();
	});
}

const AXIS_COLORS = ["#d94b4b", "#4c9d68", "#477fd1"];

function disposeGroup(group) {
	group.traverse((object) => {
		object.geometry?.dispose();
		for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
			material.map?.dispose(); material.dispose();
		}
	});
	group.clear();
}

function addSegment(positions, colors, start, end, color) {
	const tint = new THREE.Color(color);
	positions.push(...start, ...end);
	colors.push(tint.r, tint.g, tint.b, tint.r, tint.g, tint.b);
}

function lineSegments(positions, colors) {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
	return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
}

function axisLabel(value, color, worldPerPixel) {
	const canvas = document.createElement("canvas");
	canvas.width = 128; canvas.height = 48;
	const context = canvas.getContext("2d");
	context.scale(2, 2);
	context.fillStyle = "rgba(31, 36, 40, 0.86)";
	context.beginPath(); context.roundRect(1, 1, 62, 22, 5); context.fill();
	context.font = "bold 15px sans-serif"; context.textAlign = "center"; context.textBaseline = "middle";
	context.lineWidth = 2.5; context.strokeStyle = "rgba(31, 36, 40, 0.92)"; context.strokeText(String(value), 32, 12);
	context.fillStyle = color; context.fillText(String(value), 32, 12);
	const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
	const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
	sprite.scale.set(worldPerPixel * 40, worldPerPixel * 15, 1);
	return sprite;
}

export class Viewer {
	constructor(element) {
		this.element = element;
		this.scene = new THREE.Scene(); this.scene.background = new THREE.Color("#cbd1c9");
		this.fieldOfView = 42; this.projection = "perspective"; this.locked = false; this.wireframe = false; this.fitted = false;
		this.camera = new THREE.PerspectiveCamera(this.fieldOfView, 1, 0.01, 3000);
		this.camera.up.set(0, 0, 1); this.camera.position.set(88, -92, 72);
		this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		element.append(this.renderer.domElement);
		this.renderer.domElement.tabIndex = 0; this.renderer.domElement.setAttribute("aria-label", "3D model preview");
		this.controls = this.createControls(new THREE.Vector3(0, 0, 10));
		this.scene.add(new THREE.HemisphereLight("#ffffff", "#667267", 2.1));
		const light = new THREE.DirectionalLight("#fff8df", 3.2); light.position.set(-50, -70, 120); this.scene.add(light);
		this.grid = new THREE.GridHelper(300, 30, "#7f8b82", "#aeb6af"); this.grid.rotation.x = Math.PI / 2; this.grid.position.z = -0.05; this.scene.add(this.grid);
		this.model = new THREE.Group(); this.scene.add(this.model);
		this.references = new THREE.Group(); this.references.name = "reference-models"; this.scene.add(this.references);
		this.axesGroup = new THREE.Group(); this.axesGroup.name = "world-axes"; this.axesGroup.visible = false; this.scene.add(this.axesGroup);
		this.marksGroup = new THREE.Group(); this.marksGroup.name = "axis-marks"; this.marksGroup.visible = false; this.scene.add(this.marksGroup);
		this.showAxes = false; this.showMarks = false; this.axisInterval = 10; this.axisLabelCount = 0; this.guideExtent = 0;
		this.orientationCanvas = document.createElement("canvas"); this.orientationCanvas.className = "orientation-indicator"; this.orientationCanvas.setAttribute("aria-label", "XYZ camera orientation"); element.append(this.orientationCanvas);
		this.orientationContext = this.orientationCanvas.getContext("2d");
		this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(element);
		this.resize();
		this.animate = () => {
			if (this.disposed || this.paused) return;
			this.controls.update(); this.updateGuides(); this.drawOrientation(); this.renderer.render(this.scene, this.camera);
			this.frame = requestAnimationFrame(this.animate);
		};
		this.animate();
	}
	setPaused(value) {
		if (this.disposed || this.paused === Boolean(value)) return;
		this.paused = Boolean(value);
		cancelAnimationFrame(this.frame);
		if (!this.paused) this.animate();
	}
	createControls(target) {
		const controls = new OrbitControls(this.camera, this.renderer.domElement);
		controls.enableDamping = true; controls.dampingFactor = 0.08; controls.target.copy(target); controls.update();
		controls.listenToKeyEvents(this.renderer.domElement);
		return controls;
	}
	setModel(result) {
		const next = new THREE.Group();
		try {
			if (!result.empty) next.add(objectFromMesh(result.getMesh(), result.materials));
			for (const overlay of result.getOverlays()) next.add(objectFromMesh(overlay.mesh, {}, overlay.kind));
		} catch (error) { disposeModel(next); throw error; }
		this.scene.remove(this.model); disposeModel(this.model); this.model = next; this.scene.add(next);
		this.bounds = result.bounds ? new THREE.Box3(new THREE.Vector3(...result.bounds[0]), new THREE.Vector3(...result.bounds[1])) : null;
		this.volume = result.volume;
		this.guideExtent = 0; this.updateGuides(true);
		this.setWireframe(this.wireframe);
		const authored = result.view && Object.keys(result.view).length;
		if (authored && !this.locked) this.setView(result.view);
		else if (!this.fitted) this.fit();
		this.fitted = true;
		this.updateProjection();
	}
	setReference(id, mesh, settings) {
		const next = objectFromMesh(mesh, {}, "background");
		next.name = id;
		this.removeReference(id);
		this.references.add(next);
		this.updateReference(id, settings);
	}
	updateReference(id, settings) {
		const object = this.references.getObjectByName(id);
		if (!object) return;
		object.visible = settings.visible;
		object.position.fromArray(settings.position);
		object.rotation.set(...settings.rotation.map(THREE.MathUtils.degToRad), "ZYX");
		object.scale.fromArray(settings.scale);
		for (const material of object.material) material.opacity = settings.opacity;
		object.updateMatrixWorld(true);
	}
	removeReference(id) {
		const object = this.references.getObjectByName(id);
		if (!object) return;
		this.references.remove(object); disposeModel(object);
	}
	fitReference(id) {
		const object = this.references.getObjectByName(id);
		if (object) this.fit(new THREE.Box3().setFromObject(object));
	}
	setView(view) {
		const target = this.controls.target.clone();
		this.controls.dispose();
		this.fieldOfView = applyView(this.camera, target, view, this.fieldOfView);
		if (Number.isFinite(view.$vpd) && view.$vpd > 0) this.camera.zoom = 1;
		this.controls = this.createControls(target);
		this.updateProjection();
		this.fitted = true;
	}
	viewport() { return viewportBindings(this.camera, this.controls.target, this.fieldOfView); }
	getCamera() { return { eye: this.camera.position.toArray(), target: this.controls.target.toArray(), up: this.camera.up.toArray(), projection: this.projection, fov: this.fieldOfView, zoom: this.camera.zoom }; }
	setAxesVisible(value) {
		this.showAxes = Boolean(value);
		if (!this.showAxes && this.showMarks) this.setMarksVisible(false);
		this.axesGroup.visible = this.showAxes;
		this.updateGuides(true);
	}
	setMarksVisible(value) {
		this.showMarks = Boolean(value);
		if (this.showMarks) { this.showAxes = true; this.axesGroup.visible = true; }
		this.marksGroup.visible = this.showMarks;
		this.updateGuides(true);
	}
	updateGuides(force = false) {
		if (!this.showAxes) return;
		const height = Math.max(this.element.clientHeight, 1);
		const distance = this.camera.position.distanceTo(this.controls.target);
		const worldPerPixel = this.camera.isOrthographicCamera
			? (this.camera.top - this.camera.bottom) / Math.max(this.camera.zoom, 0.0001) / height
			: 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.fieldOfView / 2)) / height;
		const interval = 10 ** Math.max(1, Math.ceil(Math.log10(Math.max(worldPerPixel * 80, 10))));
		const target = this.controls.target;
		let modelExtent = 0;
		if (this.bounds && !this.bounds.isEmpty()) for (const value of [...this.bounds.min.toArray(), ...this.bounds.max.toArray()]) modelExtent = Math.max(modelExtent, Math.abs(value));
		const viewExtent = Math.max(Math.abs(target.x), Math.abs(target.y), Math.abs(target.z)) + worldPerPixel * height * 0.7;
		const extent = Math.max(10, modelExtent * 1.1, viewExtent, interval * 1.5);
		if (!force && interval === this.axisInterval && Math.abs(extent - this.guideExtent) < interval * 0.5) return;
		this.axisInterval = interval; this.guideExtent = extent;
		disposeGroup(this.axesGroup); disposeGroup(this.marksGroup);
		const positions = [], colors = [];
		for (let axis = 0; axis < 3; axis++) {
			const first = [0, 0, 0], last = [0, 0, 0]; first[axis] = -extent; last[axis] = extent;
			addSegment(positions, colors, first, last, AXIS_COLORS[axis]);
		}
		this.axesGroup.add(lineSegments(positions, colors));
		this.axisLabelCount = 0;
		if (!this.showMarks) return;
		const tickPositions = [], tickColors = [];
		const count = Math.min(Math.floor(extent / interval), 64);
		const tickLength = Math.max(interval * 0.08, Math.min(interval * 0.2, worldPerPixel * 8));
		for (let axis = 0; axis < 3; axis++) {
			const perpendicular = [0, 1, 2].filter((index) => index !== axis);
			for (let mark = -count; mark <= count; mark++) {
				if (!mark) continue;
				const coordinate = mark * interval;
				for (const across of perpendicular) {
					const start = [0, 0, 0], end = [0, 0, 0];
					start[axis] = end[axis] = coordinate; start[across] = -tickLength / 2; end[across] = tickLength / 2;
					addSegment(tickPositions, tickColors, start, end, AXIS_COLORS[axis]);
				}
				if (mark > 0) {
					const location = [0, 0, 0]; location[axis] = coordinate;
					location[perpendicular[0]] = axis === 1 ? -tickLength * 2 : tickLength * 2;
					this.marksGroup.add(axisLabel(coordinate, AXIS_COLORS[axis], worldPerPixel));
					this.marksGroup.children.at(-1).position.set(...location);
					this.axisLabelCount++;
				}
			}
		}
		if (tickPositions.length) this.marksGroup.add(lineSegments(tickPositions, tickColors));
		this.marksGroup.visible = true;
	}
	drawOrientation() {
		const canvas = this.orientationCanvas, context = this.orientationContext;
		const size = 76, pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
		if (canvas.width !== size * pixelRatio || canvas.height !== size * pixelRatio) { canvas.width = size * pixelRatio; canvas.height = size * pixelRatio; }
		context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); context.clearRect(0, 0, size, size);
		context.fillStyle = "rgba(127, 135, 144, 0.22)"; context.strokeStyle = "rgba(127, 135, 144, 0.55)"; context.lineWidth = 1;
		context.beginPath(); context.arc(size / 2, size / 2, 34, 0, Math.PI * 2); context.fill(); context.stroke();
		this.camera.updateMatrixWorld();
		const inverse = this.camera.matrixWorldInverse;
		const axes = [["X", new THREE.Vector3(1, 0, 0)], ["Y", new THREE.Vector3(0, 1, 0)], ["Z", new THREE.Vector3(0, 0, 1)]]
			.map(([label, vector], index) => ({ label, index, direction: vector.transformDirection(inverse) }))
			.sort((first, second) => second.direction.z - first.direction.z);
		for (const { label, index, direction } of axes) {
			const start = [size / 2, size / 2], end = [start[0] + direction.x * 26, start[1] - direction.y * 26];
			context.strokeStyle = AXIS_COLORS[index]; context.lineWidth = 3; context.lineCap = "round";
			context.beginPath(); context.moveTo(...start); context.lineTo(...end); context.stroke();
			context.font = "bold 12px sans-serif"; context.textAlign = "center"; context.textBaseline = "middle";
			context.lineWidth = 3; context.strokeStyle = "rgba(31, 36, 40, 0.9)"; context.strokeText(label, end[0], end[1]);
			context.fillStyle = AXIS_COLORS[index]; context.fillText(label, end[0], end[1]);
		}
		context.fillStyle = "#3d444a"; context.beginPath(); context.arc(size / 2, size / 2, 3, 0, Math.PI * 2); context.fill();
	}
	zoomBy(factor) {
		if (!Number.isFinite(factor) || factor <= 0) throw new TypeError("Zoom factor must be positive and finite");
		const target = this.controls.target.clone();
		this.controls.dispose();
		if (this.camera.isOrthographicCamera) this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * factor, 0.0001, 10000);
		else {
			const direction = this.camera.position.clone().sub(target);
			const distance = THREE.MathUtils.clamp(direction.length() / factor, 0.01, 1000000);
			this.camera.position.copy(target).addScaledVector(direction.normalize(), distance);
		}
		this.controls = this.createControls(target); this.updateProjection();
	}
	setDirection(view) {
		const directions = { right: [1, 0, 0], left: [-1, 0, 0], back: [0, 1, 0], front: [0, -1, 0], top: [0, 0, 1], bottom: [0, 0, -1] };
		if (!Object.hasOwn(directions, view)) throw new TypeError("Unknown camera direction");
		const target = this.controls.target.clone();
		const distance = Math.max(this.camera.position.distanceTo(target), 0.01);
		this.controls.dispose();
		this.camera.up.set(...(view === "top" ? [0, 1, 0] : view === "bottom" ? [0, -1, 0] : [0, 0, 1]));
		this.camera.position.copy(target).addScaledVector(new THREE.Vector3(...directions[view]), distance);
		this.controls = this.createControls(target); this.updateProjection();
	}
	resetView() {
		this.fieldOfView = 42;
		this.camera.up.set(0, 0, 1);
		this.camera.zoom = 1;
		this.controls.dispose();
		const target = new THREE.Vector3(0, 0, 10);
		this.camera.position.set(88, -92, 72);
		this.controls = this.createControls(target);
		this.fit(); this.updateProjection();
	}
	setProjection(projection) {
		if (!["perspective", "orthographic"].includes(projection)) throw new TypeError("Unknown projection");
		if (projection === this.projection) return;
		const view = this.viewport();
		const up = this.camera.up.clone();
		this.controls.dispose();
		this.projection = projection;
		this.camera = projection === "perspective" ? new THREE.PerspectiveCamera(this.fieldOfView, 1, 0.01, 3000) : new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 3000);
		this.camera.up.copy(up); this.camera.position.set(88, -92, 72);
		const target = new THREE.Vector3();
		applyView(this.camera, target, view, this.fieldOfView);
		this.controls = this.createControls(target); this.updateProjection();
	}
	updateProjection() {
		const aspect = Math.max(this.element.clientWidth, 1) / Math.max(this.element.clientHeight, 1);
		const distance = this.camera.position.distanceTo(this.controls.target);
		this.camera.near = Math.max(distance / 10000, 0.01); this.camera.far = Math.max(distance * 100, 1000);
		if (this.camera.isPerspectiveCamera) { this.camera.aspect = aspect; this.camera.fov = this.fieldOfView; }
		else {
			const half = Math.max(distance, 0.01) * Math.tan(THREE.MathUtils.degToRad(this.fieldOfView / 2));
			this.camera.left = -half * aspect; this.camera.right = half * aspect; this.camera.top = half; this.camera.bottom = -half;
		}
		this.camera.updateProjectionMatrix();
	}
	fit(box = this.bounds ?? new THREE.Box3().setFromObject(this.model)) {
		if (box.isEmpty()) return;
		const center = box.getCenter(new THREE.Vector3());
		const radius = box.getSize(new THREE.Vector3()).length() / 2;
		const aspect = Math.max(this.element.clientWidth, 1) / Math.max(this.element.clientHeight, 1);
		const vertical = THREE.MathUtils.degToRad(this.fieldOfView / 2);
		const angle = Math.min(vertical, Math.atan(Math.tan(vertical) * aspect));
		const distance = Math.max(radius / Math.sin(angle) * 1.15, 1);
		const direction = this.camera.position.clone().sub(this.controls.target).normalize();
		this.controls.dispose();
		this.camera.position.copy(center).addScaledVector(direction, distance); this.camera.zoom = 1;
		this.controls = this.createControls(center); this.updateProjection();
	}
	setWireframe(value) {
		this.wireframe = value;
		this.model.traverse((object) => { if (object.isMesh) for (const material of object.material) material.wireframe = value; });
	}
	resize() {
		if (this.disposed || !this.element.clientWidth || !this.element.clientHeight) return;
		this.renderer.setSize(this.element.clientWidth, this.element.clientHeight, false); this.updateProjection();
	}
	stats() {
		const meshes = this.model.children;
		return { meshes: meshes.length, solid: meshes.filter((mesh) => mesh.userData.scadLayer === "solid").length, background: meshes.filter((mesh) => mesh.userData.scadLayer === "background").length, debug: meshes.filter((mesh) => mesh.userData.scadLayer === "debug").length, volume: this.volume, materials: meshes.flatMap((mesh) => mesh.material.map((material) => ({ color: material.color.getHexString(), opacity: material.opacity }))) };
	}
	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		cancelAnimationFrame(this.frame); this.observer.disconnect(); this.controls.dispose(); disposeModel(this.model); this.grid.geometry.dispose(); this.grid.material.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
		disposeGroup(this.axesGroup); disposeGroup(this.marksGroup); this.orientationCanvas.remove();
		disposeGroup(this.references);
	}
}