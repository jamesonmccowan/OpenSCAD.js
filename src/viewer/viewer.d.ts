import type { ScadValue, SuccessfulCompilation } from "../index.js";

export interface ViewerCamera {
	eye: number[];
	target: number[];
	up: number[];
	projection: "perspective" | "orthographic";
	fov: number;
	zoom: number;
}

export interface ViewportBindings {
	$vpt: number[];
	$vpr: number[];
	$vpd: number;
	$vpf: number;
}

export interface ViewerStats {
	meshes: number;
	solid: number;
	background: number;
	debug: number;
	volume?: number;
	materials: { color: string; opacity: number }[];
}

export type CameraDirection = "right" | "left" | "back" | "front" | "top" | "bottom";

export interface ReferenceSettings {
	visible: boolean;
	opacity: number;
	position: number[];
	rotation: number[];
	scale: number[];
}

export class Viewer {
	constructor(element: HTMLElement);
	locked: boolean;
	wireframe: boolean;
	projection: "perspective" | "orthographic";
	showAxes: boolean;
	showMarks: boolean;
	axisInterval: number;
	setModel(result: SuccessfulCompilation): void;
	setReference(id: string, mesh: { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array }, settings: ReferenceSettings): void;
	updateReference(id: string, settings: ReferenceSettings): void;
	removeReference(id: string): void;
	fitReference(id: string): void;
	setView(view: Readonly<Record<string, ScadValue>>): void;
	viewport(): ViewportBindings;
	getCamera(): ViewerCamera;
	zoomBy(factor: number): void;
	setDirection(view: "right" | "left" | "back" | "front" | "top" | "bottom"): void;
	resetView(): void;
	setAxesVisible(value: boolean): void;
	setMarksVisible(value: boolean): void;
	setProjection(projection: "perspective" | "orthographic"): void;
	fit(): void;
	setWireframe(value: boolean): void;
	setPaused(value: boolean): void;
	resize(): void;
	stats(): ViewerStats;
	dispose(): void;
}