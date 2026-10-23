import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { applyView, viewportBindings } from "../src/viewer/camera.js";

test("native gimbal conventions round-trip through camera eye/up vectors", () => {
	for (const rotation of [[55, 0, 25], [90, 0, 0], [40, 20, 60]]) {
		const camera = new THREE.PerspectiveCamera(42); camera.up.set(0, 0, 1); camera.position.set(10, -10, 10);
		const target = new THREE.Vector3();
		const fov = applyView(camera, target, { $vpr: rotation, $vpt: [1, 2, 3], $vpd: 80, $vpf: 30 }, 42);
		const state = viewportBindings(camera, target, fov);
		assert.deepEqual(state.$vpt, [1, 2, 3]); assert.ok(Math.abs(state.$vpd - 80) < 1e-9);
		state.$vpr.forEach((angle, index) => assert.ok(Math.abs(angle - rotation[index]) < 1e-9));
		assert.equal(state.$vpf, 30);
	}
});

test("native two-component view vectors default their third component to zero", () => {
	const camera = new THREE.PerspectiveCamera(42); camera.up.set(0, 0, 1); camera.position.set(10, -10, 10);
	const target = new THREE.Vector3();
	applyView(camera, target, { $vpt: [1, 2], $vpr: [55, 0], $vpd: 80 }, 42);
	const state = viewportBindings(camera, target);
	assert.deepEqual(state.$vpt, [1, 2, 0]); assert.ok(Math.abs(state.$vpr[2]) < 1e-9);
});