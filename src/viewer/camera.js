import * as THREE from "three";

export function nativeOrientation(rotation) {
	const radians = rotation.map(THREE.MathUtils.degToRad);
	return new THREE.Matrix4().makeRotationZ(radians[2]).multiply(new THREE.Matrix4().makeRotationY(radians[1])).multiply(new THREE.Matrix4().makeRotationX(radians[0] - Math.PI / 2));
}

export function viewportBindings(camera, target, fieldOfView = camera.fov ?? 42) {
	camera.updateMatrixWorld();
	const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
	const back = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate();
	const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
	const rotation = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, back, up), "ZYX");
	return {
		$vpt: target.toArray(),
		$vpr: [rotation.x + Math.PI / 2, rotation.y, rotation.z].map((angle) => (THREE.MathUtils.radToDeg(angle) % 360 + 360) % 360),
		$vpd: camera.position.distanceTo(target) / (camera.isOrthographicCamera ? camera.zoom : 1),
		$vpf: fieldOfView,
	};
}

export function applyView(camera, target, view, fieldOfView) {
	const distance = camera.position.distanceTo(target);
	const direction = camera.position.clone().sub(target).normalize();
	const vec3 = (value) => Array.isArray(value) && [2, 3].includes(value.length) && value.every(Number.isFinite) ? [value[0], value[1], value[2] ?? 0] : null;
	const translation = vec3(view.$vpt);
	const rotation = vec3(view.$vpr);
	if (translation) target.fromArray(translation);
	let nextDistance = Number.isFinite(view.$vpd) && view.$vpd > 0 ? view.$vpd : distance;
	nextDistance = Math.max(nextDistance, 0.01);
	if (rotation) {
		const matrix = nativeOrientation(rotation);
		direction.set(0, -1, 0).transformDirection(matrix);
		camera.up.set(0, 0, 1).transformDirection(matrix);
	}
	camera.position.copy(target).addScaledVector(direction, nextDistance);
	camera.lookAt(target);
	return Number.isFinite(view.$vpf) && view.$vpf > 0 && view.$vpf < 180 ? view.$vpf : fieldOfView;
}