import { DEFAULT_SPECIAL_VARIABLES, tessellateCylinder, tessellateSphere } from "./tessellation.js";

export class GeometryAdapter {
	constructor(module, { specialVariables = {}, maxTriangles = 1_000_000, onDiagnostic = () => {} } = {}) {
		if (!Number.isSafeInteger(maxTriangles) || maxTriangles < 0) throw new RangeError("maxTriangles must be a nonnegative safe integer");
		this.module = module;
		this.specialVariables = Object.freeze({ ...DEFAULT_SPECIAL_VARIABLES, ...specialVariables });
		this.options = Object.freeze({ maxTriangles, diagnostic: onDiagnostic });
	}

	withSpecialVariables(overrides) {
		return new GeometryAdapter(this.module, {
			specialVariables: { ...this.specialVariables, ...overrides },
			maxTriangles: this.options.maxTriangles,
			onDiagnostic: this.options.diagnostic,
		});
	}

	sphere(args = {}, scope = {}) {
		return this.createSolid(tessellateSphere, args, scope);
	}

	cylinder(args = {}, scope = {}) {
		return this.createSolid(tessellateCylinder, args, scope);
	}

	createSolid(tessellator, args, scope) {
		const settings = { ...this.specialVariables, ...scope };
		for (const name of ["$fn", "$fa", "$fs"]) {
			if (Object.hasOwn(args, name)) settings[name] = args[name];
		}
		const mesh = tessellator(args, settings, this.options);
		const solid = new this.module.Manifold(new this.module.Mesh(mesh));
		const status = solid.status();
		if (status !== "NoError") {
			solid.delete();
			throw new Error(`Primitive construction failed: ${status}`);
		}
		return solid;
	}
}