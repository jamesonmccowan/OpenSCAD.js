import { unzipSync } from 'fflate';
import { decodeStl } from '../../src/geometry/import-stl.js';

export const MAX_MODEL_TRIANGLES = 2_000_000;

export function decodeModel(message, format, maxTriangles = MAX_MODEL_TRIANGLES) {
  if (Array.isArray(message.meshes)) {
    return meshFromOcct(message.meshes.map(mesh => {
      if (typeof mesh?.position !== 'string' || typeof mesh?.index !== 'string') throw new Error('STEP mesh data was not received');
      const position = base64ToBytes(mesh.position), index = base64ToBytes(mesh.index);
      if (position.byteLength % 12 || index.byteLength % 12) throw new Error('STEP mesh data is malformed');
      return { position: new Float32Array(position.buffer, position.byteOffset, position.byteLength / 4), index: new Uint32Array(index.buffer, index.byteOffset, index.byteLength / 4) };
    }), maxTriangles);
  }
  if (typeof message.data !== 'string') throw new Error('Model data was not received');
  const bytes = base64ToBytes(message.data);
  if (Number.isInteger(message.size) && bytes.byteLength !== message.size) throw new Error(`Model transfer was truncated: received ${bytes.byteLength} of ${message.size} bytes`);
  return format === '3mf' ? decode3mf(bytes, maxTriangles) : decodeStl(bytes, maxTriangles);
}

const MAX_3MF_UNCOMPRESSED_BYTES = 500_000_000;
const MAX_COMPONENT_DEPTH = 32;
const UNIT_SCALE = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

// Collects triangles and welds identical vertices so seams between CAD faces or
// 3MF objects share vertices, which the watertightness analysis depends on.
export class MeshBuilder {
  constructor(maxTriangles) {
    this.maxTriangles = maxTriangles;
    this.positions = [];
    this.triangles = [];
    this.vertices = new Map();
    this.scratch = new Float32Array(3);
  }

  vertex(x, y, z) {
    const point = this.scratch;
    point[0] = x; point[1] = y; point[2] = z;
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]) || !Number.isFinite(point[2])) throw new Error('Model contains non-finite coordinates');
    const key = `${point[0]},${point[1]},${point[2]}`;
    let index = this.vertices.get(key);
    if (index === undefined) {
      index = this.vertices.size;
      this.vertices.set(key, index);
      this.positions.push(point[0], point[1], point[2]);
    }
    return index;
  }

  triangle(a, b, c) {
    if (a === b || b === c || c === a) return;
    if (this.triangles.length / 3 >= this.maxTriangles) throw new Error(`Model exceeds the ${this.maxTriangles.toLocaleString('en-US')} triangle viewer limit`);
    this.triangles.push(a, b, c);
  }

  finish() {
    return { numProp: 3, vertProperties: Float32Array.from(this.positions), triVerts: Uint32Array.from(this.triangles) };
  }
}

export function meshFromOcct(meshes, maxTriangles) {
  const builder = new MeshBuilder(maxTriangles);
  for (const mesh of meshes) {
    const { position, index } = mesh;
    const map = new Uint32Array(position.length / 3);
    for (let vertex = 0; vertex < map.length; vertex++) map[vertex] = builder.vertex(position[vertex * 3], position[vertex * 3 + 1], position[vertex * 3 + 2]);
    for (let corner = 0; corner + 2 < index.length; corner += 3) {
      const a = index[corner], b = index[corner + 1], c = index[corner + 2];
      if (a >= map.length || b >= map.length || c >= map.length) throw new Error('STEP tessellation references a missing vertex');
      builder.triangle(map[a], map[b], map[c]);
    }
  }
  return builder.finish();
}

const children = (element, name) => Array.from(element.children).filter(child => child.localName === name);
const child = (element, name) => children(element, name)[0];
const attribute = (element, name) => {
  for (const value of element.attributes) if (value.localName === name) return value.value;
  return null;
};
const normalizePath = value => value.replace(/\\/g, '/').replace(/^\/+/, '');

function parseTransform(value) {
  if (!value) return IDENTITY;
  const numbers = value.trim().split(/\s+/).map(Number);
  if (numbers.length !== 12 || !numbers.every(Number.isFinite)) throw new Error(`Invalid 3MF transform "${value}"`);
  return numbers;
}

// 3MF matrices use row vectors: [x y z 1] × M. Applying `first` then `second`.
function compose(first, second) {
  const result = new Array(12);
  for (let row = 0; row < 4; row++) for (let column = 0; column < 3; column++) {
    result[row * 3 + column] = first[row * 3] * second[column] + first[row * 3 + 1] * second[3 + column] + first[row * 3 + 2] * second[6 + column] + (row === 3 ? second[9 + column] : 0);
  }
  return result;
}

function parseXml(text, path) {
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error(`3MF part ${path} is not valid XML`);
  return document;
}

export function decode3mf(bytes, maxTriangles) {
  let total = 0;
  let entries;
  try {
    entries = unzipSync(bytes, { filter: file => {
      if (!/\.(model|rels)$/i.test(file.name)) return false;
      total += file.originalSize;
      if (total > MAX_3MF_UNCOMPRESSED_BYTES) throw new Error(`3MF model data exceeds ${MAX_3MF_UNCOMPRESSED_BYTES / 1_000_000} MB uncompressed`);
      return true;
    } });
  } catch (error) {
    throw new Error(/exceeds/.test(error.message) ? error.message : `File is not a valid 3MF archive (${error.message})`);
  }
  const files = new Map(Object.entries(entries).map(([name, data]) => [normalizePath(name), data]));
  const decoder = new TextDecoder();
  let rootPath = '3D/3dmodel.model';
  const relationships = files.get('_rels/.rels');
  if (relationships) {
    const start = Array.from(parseXml(decoder.decode(relationships), '_rels/.rels').getElementsByTagNameNS('*', 'Relationship')).find(element => /\/3dmodel$/.test(attribute(element, 'Type') ?? ''));
    if (start) rootPath = normalizePath(attribute(start, 'Target'));
  }
  const models = new Map();
  const model = path => {
    if (!models.has(path)) {
      const data = files.get(path);
      if (!data) throw new Error(`3MF archive is missing model part ${path}`);
      const root = parseXml(decoder.decode(data), path).documentElement;
      if (root.localName !== 'model') throw new Error(`3MF part ${path} has no model element`);
      const objects = new Map();
      for (const resources of children(root, 'resources')) for (const object of children(resources, 'object')) objects.set(attribute(object, 'id'), object);
      models.set(path, { root, objects });
    }
    return models.get(path);
  };
  const root = model(rootPath);
  const scale = UNIT_SCALE[attribute(root.root, 'unit') ?? 'millimeter'];
  if (!scale) throw new Error(`Unsupported 3MF unit "${attribute(root.root, 'unit')}"`);
  const builder = new MeshBuilder(maxTriangles);
  const meshCache = new Map();
  const readMesh = (key, mesh) => {
    if (!meshCache.has(key)) {
      const vertexElements = child(mesh, 'vertices') ? children(child(mesh, 'vertices'), 'vertex') : [];
      const vertices = new Float64Array(vertexElements.length * 3);
      vertexElements.forEach((vertex, index) => { for (const [axis, name] of ['x', 'y', 'z'].entries()) vertices[index * 3 + axis] = Number(attribute(vertex, name)); });
      const triangleElements = child(mesh, 'triangles') ? children(child(mesh, 'triangles'), 'triangle') : [];
      const triangles = new Uint32Array(triangleElements.length * 3);
      triangleElements.forEach((triangle, index) => {
        for (const [corner, name] of ['v1', 'v2', 'v3'].entries()) {
          const value = Number(attribute(triangle, name));
          if (!Number.isInteger(value) || value < 0 || value >= vertexElements.length) throw new Error('3MF triangle references a missing vertex');
          triangles[index * 3 + corner] = value;
        }
      });
      meshCache.set(key, { vertices, triangles });
    }
    return meshCache.get(key);
  };
  const emit = (path, id, transform, depth, stack) => {
    const key = `${path}#${id}`;
    if (depth > MAX_COMPONENT_DEPTH || stack.has(key)) throw new Error('3MF components are nested too deeply or recursive');
    const object = model(path).objects.get(id);
    if (!object) throw new Error(`3MF references missing object ${id} in ${path}`);
    if (['support', 'other'].includes(attribute(object, 'type'))) return;
    const mesh = child(object, 'mesh');
    if (mesh) {
      const { vertices, triangles } = readMesh(key, mesh);
      const map = new Uint32Array(vertices.length / 3);
      const m = transform;
      for (let vertex = 0; vertex < map.length; vertex++) {
        const x = vertices[vertex * 3], y = vertices[vertex * 3 + 1], z = vertices[vertex * 3 + 2];
        map[vertex] = builder.vertex(
          (x * m[0] + y * m[3] + z * m[6] + m[9]) * scale,
          (x * m[1] + y * m[4] + z * m[7] + m[10]) * scale,
          (x * m[2] + y * m[5] + z * m[8] + m[11]) * scale,
        );
      }
      for (let corner = 0; corner < triangles.length; corner += 3) builder.triangle(map[triangles[corner]], map[triangles[corner + 1]], map[triangles[corner + 2]]);
    }
    const components = child(object, 'components');
    if (!components) return;
    stack.add(key);
    for (const component of children(components, 'component')) {
      const target = attribute(component, 'path') ? normalizePath(attribute(component, 'path')) : path;
      emit(target, attribute(component, 'objectid'), compose(parseTransform(attribute(component, 'transform')), transform), depth + 1, stack);
    }
    stack.delete(key);
  };
  const build = child(root.root, 'build');
  for (const item of build ? children(build, 'item') : []) {
    const target = attribute(item, 'path') ? normalizePath(attribute(item, 'path')) : rootPath;
    emit(target, attribute(item, 'objectid'), parseTransform(attribute(item, 'transform')), 0, new Set());
  }
  const result = builder.finish();
  if (!result.triVerts.length) throw new Error('3MF build contains no printable triangles');
  return result;
}

export function bytesToBase64(bytes) {
  let text = '';
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
  return btoa(text);
}

export function base64ToBytes(data) {
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index);
  return bytes;
}
