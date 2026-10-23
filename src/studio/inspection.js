import * as THREE from "three";

// Viewport annotations never enter the compiler or the exported mesh.
export function inspectionControls(viewer, { basename, reportError, preferences }) {
	const find = (id) => document.getElementById(id);
	const tabs = [...document.querySelectorAll('.tool-tabs [role="tab"]')];
	function selectTab(selected) {
		for (const tab of tabs) {
			const active = tab === selected;
			tab.setAttribute("aria-selected", String(active));
			tab.tabIndex = active ? 0 : -1;
			find(tab.getAttribute("aria-controls")).hidden = !active;
		}
		preferences.set({ tab: selected.id });
		selected.scrollIntoView({ block: "nearest", inline: "nearest" });
	}
	selectTab(find(preferences.get("tab") ?? "hide-tab"));
	viewer.setProjection(preferences.get("projection") ?? "perspective");
	find("projection-button").setAttribute("aria-pressed", String(viewer.projection === "orthographic"));
	viewer.setAxesVisible(preferences.get("axes") ?? false);
	viewer.setMarksVisible(preferences.get("marks") ?? false);
	find("show-axes").checked = viewer.showAxes; find("show-marks").checked = viewer.showMarks;
	for (const tab of tabs) {
		tab.addEventListener("click", () => selectTab(tab));
		tab.addEventListener("keydown", (event) => {
			let index = tabs.indexOf(tab);
			if (event.key === "ArrowRight") index = (index + 1) % tabs.length;
			else if (event.key === "ArrowLeft") index = (index + tabs.length - 1) % tabs.length;
			else if (event.key === "Home") index = 0;
			else if (event.key === "End") index = tabs.length - 1;
			else return;
			event.preventDefault(); selectTab(tabs[index]); tabs[index].focus();
		});
	}

	find("camera-direction").addEventListener("change", (event) => {
		if (event.target.value === "reset") viewer.resetView();
		else if (event.target.value) viewer.setDirection(event.target.value);
		event.target.value = "";
	});
	find("zoom-in-button").addEventListener("click", () => viewer.zoomBy(1.25));
	find("zoom-out-button").addEventListener("click", () => viewer.zoomBy(0.8));
	find("show-axes").addEventListener("change", (event) => {
		viewer.setAxesVisible(event.target.checked); find("show-marks").checked = viewer.showMarks;
		preferences.set({ axes: viewer.showAxes, marks: viewer.showMarks });
	});
	find("show-marks").addEventListener("change", (event) => {
		viewer.setMarksVisible(event.target.checked); find("show-axes").checked = viewer.showAxes;
		preferences.set({ axes: viewer.showAxes, marks: viewer.showMarks });
	});
	find("snapshot-button").addEventListener("click", () => {
		try {
			viewer.renderer.render(viewer.scene, viewer.camera);
			const link = document.createElement("a");
			link.href = viewer.renderer.domElement.toDataURL("image/png");
			link.download = `${basename()}-preview.png`; link.click();
		} catch (error) { reportError(error); }
	});

	viewer.renderer.localClippingEnabled = true;
	const plane = new THREE.Plane();
	function updateSlicing() {
		const axis = find("slice-axis").value;
		const min = viewer.bounds?.min[axis] ?? 0, max = viewer.bounds?.max[axis] ?? 100;
		const position = min + Number(find("slice-offset").value) / 100 * (max - min);
		const sign = find("slice-invert").checked ? 1 : -1;
		plane.normal.set(axis === "x" ? sign : 0, axis === "y" ? sign : 0, axis === "z" ? sign : 0);
		plane.constant = -sign * position;
		find("slice-value").textContent = `${position.toFixed(2)} mm`;
		viewer.model.traverse((object) => {
			if (!object.isMesh) return;
			for (const material of object.material) {
				material.clippingPlanes = find("slice-enabled").checked ? [plane] : [];
				material.clipShadows = true; material.needsUpdate = true;
			}
		});
	}
	for (const id of ["slice-enabled", "slice-axis", "slice-offset", "slice-invert"]) {
		find(id).addEventListener(id === "slice-offset" ? "input" : "change", () => { clearMeasurement(); updateSlicing(); });
	}

	const overlay = new THREE.Group(); overlay.name = "measurement-annotation"; viewer.scene.add(overlay);
	const raycaster = new THREE.Raycaster();
	let measuring = false, points = [], measurement, pointerStart;
	const readout = find("measurement-readout");
	function updateMeasurementControls() {
		find("measure-toggle").disabled = !viewer.model.children.length;
		find("measure-toggle").setAttribute("aria-pressed", String(measuring));
		viewer.element.classList.toggle("measuring", measuring);
		find("measure-copy").disabled = !measurement;
		find("measure-clear").disabled = !points.length && !measuring;
	}
	function clearMeasurement() {
		for (const object of overlay.children) { object.geometry.dispose(); object.material.dispose(); }
		overlay.clear(); measuring = false; points = []; measurement = undefined;
		readout.hidden = true; readout.textContent = ""; updateMeasurementControls();
	}
	function marker(point, color) {
		const radius = Math.max((viewer.bounds?.getSize(new THREE.Vector3()).length() ?? 50) * 0.006, 0.3);
		const object = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false }));
		object.position.copy(point); object.renderOrder = 1001; overlay.add(object);
	}
	function describeMeasurement() {
		const delta = points[1].clone().sub(points[0]), distance = delta.length();
		const tolerance = find("measure-tolerance").value ? Number(find("measure-tolerance").value) : null;
		const round = (value) => Number(value.toFixed(4));
		measurement = {
			distance: round(distance), delta: { x: round(delta.x), y: round(delta.y), z: round(delta.z) },
			points: points.map((point) => point.toArray().map(round)), units: "mm",
			tolerance, withinTolerance: tolerance === null ? null : distance <= tolerance,
		};
		readout.textContent = `Distance ${distance.toFixed(3)} mm | ${["x", "y", "z"].map((axis) => `Delta ${axis.toUpperCase()} ${delta[axis] >= 0 ? "+" : ""}${delta[axis].toFixed(3)} mm`).join(" | ")}${tolerance === null ? "" : ` | ${distance <= tolerance ? "Within" : "Over"} ${tolerance.toFixed(2)} mm gap target`}`;
	}
	function measure(event) {
		if (!measuring || event.button !== 0) return;
		const rect = viewer.renderer.domElement.getBoundingClientRect();
		raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), viewer.camera);
		const hit = raycaster.intersectObjects(viewer.model.children, true).find((intersection) => {
			const materials = intersection.object.material;
			const material = materials[intersection.face?.materialIndex ?? 0];
			return !material.clippingPlanes?.some((clip) => clip.distanceToPoint(intersection.point) < -1e-5);
		});
		readout.hidden = false;
		if (!hit) { readout.textContent = "No visible model surface at that point. Try another spot."; return; }
		points.push(hit.point.clone()); marker(hit.point, points.length === 1 ? "#ff4f78" : "#ffd166");
		if (points.length === 1) readout.textContent = `First point: ${hit.point.toArray().map((value) => value.toFixed(3)).join(", ")} mm. Select the second point.`;
		else {
			const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: "#ffcf4a", depthTest: false, depthWrite: false }));
			line.renderOrder = 1002; overlay.add(line); describeMeasurement(); measuring = false;
		}
		updateMeasurementControls();
	}
	find("measure-toggle").addEventListener("click", () => {
		const enable = !measuring; clearMeasurement(); measuring = enable;
		if (enable) { readout.hidden = false; readout.textContent = "Select the first point on the model."; }
		updateMeasurementControls();
	});
	find("measure-clear").addEventListener("click", clearMeasurement);
	find("measure-tolerance").addEventListener("change", () => { if (measurement) describeMeasurement(); });
	find("measure-copy").addEventListener("click", async () => {
		if (!measurement) return;
		try {
			if (!navigator.clipboard) throw new Error("Clipboard access requires HTTPS or localhost in this browser");
			await navigator.clipboard.writeText(JSON.stringify(measurement, null, 2));
		}
		catch (error) { reportError(new Error(`Could not copy measurement: ${error.message}`)); }
	});
	const canvas = viewer.renderer.domElement;
	canvas.addEventListener("pointerdown", (event) => { pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY }; });
	canvas.addEventListener("pointerup", (event) => {
		const start = pointerStart; pointerStart = undefined;
		if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 4) measure(event);
	});
	canvas.addEventListener("pointercancel", () => { pointerStart = undefined; });

	function modelChanged() {
		clearMeasurement(); updateSlicing();
		const size = viewer.bounds?.getSize(new THREE.Vector3());
		let triangles = 0;
		viewer.model.traverse((object) => { if (object.isMesh && object.userData.scadLayer === "solid") triangles += object.geometry.index.count / 3; });
		find("model-metrics").textContent = size
			? `${size.toArray().map((value) => value.toFixed(2)).join(" × ")} mm | Volume ${(viewer.volume ?? 0).toFixed(2)} mm³ | ${triangles.toLocaleString()} triangles`
			: "Empty model | 0 triangles";
	}
	updateMeasurementControls();
	return { modelChanged, clearMeasurement, dispose() { clearMeasurement(); viewer.scene.remove(overlay); } };
}
