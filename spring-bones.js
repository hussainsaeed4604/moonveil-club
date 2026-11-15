import * as THREE from 'three';

// Secondary motion for VRoid hair, sleeves, skirts, and tassels.
//
// No physics engine. Each bone remembers where its tip was last frame.
// The tip keeps a fraction of that swing (drag), is nudged back toward
// the pose the artist built (stiffness), and is pulled down a little
// (gravity). A few body spheres stop the cloth falling through the legs.
//
// Stiffness and gravity are the UniVRM numbers: meters added along that
// direction per second. At 60fps that is value/60 meters in one frame.
// Drag is the fraction of swing speed thrown away each 60fps frame.
// Other frame rates use (1 - drag) ^ (dt * 60), so 30fps feels like two
// of those frames instead of a different fabric.

const DEG = Math.PI / 180;
const EMPTY = [];

const PRESETS = {
  hairFront: {
    id: 'hairFront',
    stiffness: 1.0,
    drag: 0.40,
    gravity: 0.10,
    hitRadius: 0.02,
    cap: 30 * DEG,
    phone: false,
    colliders: [
      { bone: 'J_Bip_C_UpperChest', radius: 0.12, along: 0 },
      { bone: 'J_Bip_C_Chest', radius: 0.12, along: 0 }
    ]
  },
  hair: {
    id: 'hair',
    stiffness: 0.8,
    // Artist sheet was 0.35. A little less drag lets the back hair finish a step.
    drag: 0.28,
    gravity: 0.10,
    hitRadius: 0.04,
    cap: 30 * DEG,
    phone: true,
    colliders: [
      { bone: 'J_Bip_C_Head', radius: 0.11, along: 0 },
      // Shift the chest sphere toward the front of the body. Centered on the
      // joint it sits inside the back hair and buzzes. -Z is the robe's front.
      { bone: 'J_Bip_C_UpperChest', radius: 0.13, along: 0, offset: [0, 0, -0.05] },
      { bone: 'J_Bip_C_Neck', radius: 0.06, along: 0 }
    ]
  },
  sleeve: {
    id: 'sleeve',
    stiffness: 0.9,
    drag: 0.40,
    gravity: 0.20,
    hitRadius: 0.05,
    cap: 45 * DEG,
    phone: false,
    colliders: [
      { bone: 'J_Bip_C_Hips', radius: 0.16, along: 0 },
      { bone: 'J_Bip_L_UpperLeg', radius: 0.09, along: 0.5 },
      { bone: 'J_Bip_R_UpperLeg', radius: 0.09, along: 0.5 }
    ]
  },
  skirt: {
    id: 'skirt',
    stiffness: 1.2,
    stiffnessTip: 0.8,
    gradient: true,
    // Artist sheet was drag 0.45 and gravity 0.15. The heavier drag stopped
    // the hem mid-stride. 0.22 lets it finish the step and settle in about
    // half a second. Gravity is only a little higher so the hem hangs;
    // the leg spheres, not gravity, keep it off the thighs.
    drag: 0.22,
    gravity: 0.20,
    hitRadius: 0.06,
    cap: 35 * DEG,
    phone: true,
    colliders: [
      { bone: 'J_Bip_L_UpperLeg', radius: 0.09, along: 0.5 },
      { bone: 'J_Bip_R_UpperLeg', radius: 0.09, along: 0.5 },
      { bone: 'J_Bip_L_LowerLeg', radius: 0.07, along: 0.5 },
      { bone: 'J_Bip_R_LowerLeg', radius: 0.07, along: 0.5 },
      { bone: 'J_Bip_C_Hips', radius: 0.14, along: 0 }
    ]
  },
  tassel: {
    id: 'tassel',
    stiffness: 0.5,
    drag: 0.25,
    gravity: 0.35,
    hitRadius: 0.01,
    cap: 45 * DEG,
    phone: false,
    colliders: [
      { bone: 'J_Bip_C_Hips', radius: 0.14, along: 0 }
    ]
  }
};

const sHead = new THREE.Vector3();
const sDir = new THREE.Vector3();
const sNext = new THREE.Vector3();
const sA = new THREE.Vector3();
const sB = new THREE.Vector3();
const sC = new THREE.Vector3();
const sScale = new THREE.Vector3();
const sRoot = new THREE.Vector3();
const mA = new THREE.Matrix4();

function isSpringName(name) {
  return !!name &&
    name.indexOf('J_Sec_') === 0 &&
    name.indexOf('_end') === -1 &&
    name.indexOf('Bust') === -1;
}

function chainStem(name) {
  return name.replace(/(?:_\d+|\d+)$/, '');
}

function presetFor(name) {
  if (name.indexOf('J_Sec_HairFront') === 0) return PRESETS.hairFront;
  if (name.indexOf('J_Sec_Hair') === 0) return PRESETS.hair;
  if (name.indexOf('J_Sec_Sleeve_L') === 0 || name.indexOf('J_Sec_Sleeve_R') === 0) return PRESETS.sleeve;
  if (name.indexOf('J_Sec_Skirt') === 0 || name.indexOf('J_Sec_L_Skirt') === 0 || name.indexOf('J_Sec_R_Skirt') === 0) return PRESETS.skirt;
  if (name.indexOf('J_Sec_Tassel') === 0) return PRESETS.tassel;
  return null;
}

function nextInChain(bone, stem) {
  const kids = bone.children;
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i];
    if (kid.isBone && isSpringName(kid.name) && chainStem(kid.name) === stem) return kid;
  }
  return null;
}

function localTailOf(bone, stem) {
  const next = nextInChain(bone, stem);
  if (next) return next.position.clone();
  const kids = bone.children;
  for (let i = 0; i < kids.length; i++) {
    const name = kids[i].name || '';
    if (name.indexOf('_end') !== -1 && name.indexOf(stem) === 0) return kids[i].position.clone();
  }
  const len = bone.position.length() || 0.07;
  return new THREE.Vector3(0, len, 0);
}

function bipChild(bone) {
  const kids = bone.children;
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i];
    if (kid.isBone && kid.name && kid.name.indexOf('J_Bip_') === 0) return kid;
  }
  return null;
}

function boneDepth(bone) {
  let depth = 0;
  for (let p = bone.parent; p; p = p.parent) depth++;
  return depth;
}

function stiffnessAt(preset, index, count) {
  if (!preset.gradient || count <= 1) return preset.stiffness;
  const t = index / (count - 1);
  return preset.stiffness + (preset.stiffnessTip - preset.stiffness) * t;
}

function noopSet() {
  return {
    update() {},
    reset() {},
    boneCount: 0,
    chainCount: 0,
    describe() {
      return { bones: 0, chains: 0, skirt: 0, hair: 0, hairFront: 0, sleeve: 0, tassel: 0 };
    },
    sample() {
      return { max: 0, finite: true, byKind: { skirt: 0, hair: 0, hairFront: 0, sleeve: 0, tassel: 0 } };
    }
  };
}

function createSpringSet(root, options) {
  const opts = options || {};
  const bones = [];
  root.traverse((obj) => {
    if (obj.isBone && isSpringName(obj.name)) bones.push(obj);
  });
  if (!bones.length) return noopSet();

  const colliderCache = Object.create(null);
  function colliderList(preset, parentBone) {
    if (preset.id === 'tassel') {
      const n = parentBone && parentBone.name ? parentBone.name : '';
      const waist = n.indexOf('Hips') !== -1 || n.indexOf('Spine') !== -1 || n.indexOf('Skirt') !== -1;
      if (!waist) return EMPTY;
    }
    if (!colliderCache[preset.id]) {
      const list = [];
      const specs = preset.colliders;
      for (let i = 0; i < specs.length; i++) {
        const bone = root.getObjectByName(specs[i].bone);
        if (!bone) continue;
        const along = specs[i].along || 0;
        list.push({
          bone,
          child: along > 0 ? bipChild(bone) : null,
          radius: specs[i].radius,
          along,
          offset: specs[i].offset || null,
          center: new THREE.Vector3(),
          stamp: -1
        });
      }
      colliderCache[preset.id] = list;
    }
    return colliderCache[preset.id];
  }

  const chains = [];
  for (let i = 0; i < bones.length; i++) {
    const bone = bones[i];
    const stem = chainStem(bone.name);
    const parent = bone.parent;
    if (parent && parent.isBone && isSpringName(parent.name) && chainStem(parent.name) === stem) continue;
    const preset = presetFor(bone.name);
    if (!preset) continue;
    const joints = [];
    let cursor = bone;
    while (cursor) {
      cursor.updateMatrix();
      const localTail = localTailOf(cursor, stem);
      const boneAxis = localTail.clone();
      if (boneAxis.lengthSq() < 1e-12) boneAxis.set(0, 1, 0);
      else boneAxis.normalize();
      joints.push({
        bone: cursor,
        initialQuat: cursor.quaternion.clone(),
        initialLocalMatrix: cursor.matrix.clone(),
        localTail,
        boneAxis,
        stiffness: 0,
        currentTail: new THREE.Vector3(),
        prevTail: new THREE.Vector3()
      });
      cursor = nextInChain(cursor, stem);
    }
    for (let j = 0; j < joints.length; j++) {
      joints[j].stiffness = stiffnessAt(preset, j, joints.length);
    }
    chains.push({
      preset,
      parentBone: bone.parent || null,
      depth: boneDepth(bone),
      joints,
      colliders: colliderList(preset, bone.parent || null),
      live: false
    });
  }
  chains.sort((a, b) => a.depth - b.depth);
  if (!chains.length) return noopSet();

  let boneCount = 0;
  for (let i = 0; i < chains.length; i++) boneCount += chains[i].joints.length;

  let booted = false;
  let resting = false;
  let prevDt = 1 / 60;
  let acc = 0;
  let stamp = 0;
  const rootPrev = new THREE.Vector3();

  function policyNow() {
    if (opts.enabled && !opts.enabled()) return 'off';
    const p = opts.policy ? opts.policy() : 'full';
    if (p === 'half' || p === 'core' || p === 'off') return p;
    return 'full';
  }

  function chainRuns(chain, policy) {
    if (policy === 'full' || policy === 'half') return true;
    if (policy === 'core') return !!chain.preset.phone;
    return false;
  }

  function restMatrix(joint) {
    const parent = joint.bone.parent;
    if (parent) mA.multiplyMatrices(parent.matrixWorld, joint.initialLocalMatrix);
    else mA.copy(joint.initialLocalMatrix);
    return mA;
  }

  function snapTail(joint) {
    const mat = restMatrix(joint);
    sHead.setFromMatrixPosition(mat);
    joint.currentTail.copy(joint.localTail).applyMatrix4(mat);
    joint.prevTail.copy(joint.currentTail);
  }

  function writeBoneMatrix(bone) {
    const parent = bone.parent;
    bone.updateMatrix();
    if (parent) bone.matrixWorld.multiplyMatrices(parent.matrixWorld, bone.matrix);
    else bone.matrixWorld.copy(bone.matrix);
    bone.matrixWorldNeedsUpdate = false;
  }

  function poseRest() {
    for (let c = 0; c < chains.length; c++) {
      const joints = chains[c].joints;
      for (let j = 0; j < joints.length; j++) {
        joints[j].bone.quaternion.copy(joints[j].initialQuat);
        writeBoneMatrix(joints[j].bone);
      }
      chains[c].live = false;
    }
    for (let c = 0; c < chains.length; c++) {
      const joints = chains[c].joints;
      for (let j = 0; j < joints.length; j++) snapTail(joints[j]);
    }
  }

  function aim(joint, worldTail) {
    const bone = joint.bone;
    const mat = restMatrix(joint);
    mat.invert();
    sA.copy(worldTail).applyMatrix4(mat);
    if (sA.lengthSq() < 1e-12) bone.quaternion.copy(joint.initialQuat);
    else {
      sA.normalize();
      bone.quaternion.setFromUnitVectors(joint.boneAxis, sA).premultiply(joint.initialQuat);
    }
    if (!Number.isFinite(bone.quaternion.x)) bone.quaternion.copy(joint.initialQuat);
    writeBoneMatrix(bone);
  }

  function lengthen(next, head, dir, boneLen) {
    sA.subVectors(next, head);
    const len = sA.length();
    if (len < 1e-8) next.copy(head).addScaledVector(dir, boneLen);
    else next.copy(head).addScaledVector(sA, boneLen / len);
  }

  function swingClamp(next, head, dir, boneLen, cap) {
    sA.subVectors(next, head);
    const len = sA.length();
    if (len < 1e-8) {
      next.copy(head).addScaledVector(dir, boneLen);
      return;
    }
    sA.multiplyScalar(1 / len);
    const cos = Math.min(1, Math.max(-1, dir.dot(sA)));
    const ang = Math.acos(cos);
    if (ang > cap) {
      sB.crossVectors(dir, sA);
      if (sB.lengthSq() < 1e-10) {
        sB.set(1, 0, 0).cross(dir);
        if (sB.lengthSq() < 1e-10) sB.set(0, 0, 1);
      }
      sB.normalize();
      sA.copy(dir).applyAxisAngle(sB, cap);
    }
    next.copy(head).addScaledVector(sA, boneLen);
  }

  function refreshCollider(col) {
    if (col.stamp === stamp) return;
    col.stamp = stamp;
    col.center.setFromMatrixPosition(col.bone.matrixWorld);
    if (col.child && col.along) {
      sC.setFromMatrixPosition(col.child.matrixWorld).sub(col.center).multiplyScalar(col.along);
      col.center.add(sC);
    }
    if (col.offset) {
      const e = col.bone.matrixWorld.elements;
      const ox = col.offset[0];
      const oy = col.offset[1];
      const oz = col.offset[2];
      col.center.x += e[0] * ox + e[4] * oy + e[8] * oz;
      col.center.y += e[1] * ox + e[5] * oy + e[9] * oz;
      col.center.z += e[2] * ox + e[6] * oy + e[10] * oz;
    }
  }

  // Push the tip out of any body sphere. Returns true if it was inside one.
  // The sphere on the bone this chain hangs from is skipped: the root sits
  // inside that sphere, and hitting it fires the chain outward every frame.
  function collide(next, head, dir, boneLen, chain, worldScale) {
    const cols = chain.colliders;
    const reach = chain.preset.hitRadius * worldScale;
    let hit = false;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      if (col.bone === chain.parentBone) continue;
      refreshCollider(col);
      const rad = col.radius * worldScale + reach;
      sB.subVectors(next, col.center);
      const d2 = sB.lengthSq();
      if (d2 >= rad * rad) continue;
      if (d2 > 1e-12) sB.multiplyScalar(rad / Math.sqrt(d2));
      else sB.copy(dir).multiplyScalar(rad);
      next.copy(col.center).add(sB);
      lengthen(next, head, dir, boneLen);
      hit = true;
    }
    return hit;
  }

  function stripSphereSpeed(vel, tip, chain, worldScale) {
    const cols = chain.colliders;
    const reach = chain.preset.hitRadius * worldScale;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      if (col.bone === chain.parentBone) continue;
      const rad = col.radius * worldScale + reach;
      sB.subVectors(tip, col.center);
      const dist = sB.length();
      if (dist > rad + 0.008 || dist < 1e-6) continue;
      sB.multiplyScalar(1 / dist);
      vel.addScaledVector(sB, -vel.dot(sB));
    }
  }

  function integrate(joint, chain, stepDt, remainScale, worldScale) {
    const mat = restMatrix(joint);
    sHead.setFromMatrixPosition(mat);
    sDir.copy(joint.localTail).applyMatrix4(mat).sub(sHead);
    const boneLen = sDir.length();
    if (!(boneLen > 1e-6)) return;
    sDir.multiplyScalar(1 / boneLen);

    const carry = (stepDt / prevDt) * remainScale;
    sA.subVectors(joint.currentTail, joint.prevTail).multiplyScalar(carry);
    sNext.copy(joint.currentTail).add(sA);
    sNext.addScaledVector(sDir, joint.stiffness * stepDt);
    sNext.y -= chain.preset.gravity * stepDt;
    lengthen(sNext, sHead, sDir, boneLen);
    swingClamp(sNext, sHead, sDir, boneLen, chain.preset.cap);
    const hit = collide(sNext, sHead, sDir, boneLen, chain, worldScale);
    swingClamp(sNext, sHead, sDir, boneLen, chain.preset.cap);
    if (!Number.isFinite(sNext.x)) {
      snapTail(joint);
      aim(joint, joint.currentTail);
      return;
    }
    if (hit) {
      sA.subVectors(sNext, joint.currentTail);
      stripSphereSpeed(sA, sNext, chain, worldScale);
      joint.prevTail.copy(sNext).sub(sA);
    } else {
      joint.prevTail.copy(joint.currentTail);
    }
    joint.currentTail.copy(sNext);
    aim(joint, joint.currentTail);
  }

  function update(dt) {
    if (!(dt > 0)) return;
    const policy = policyNow();
    if (policy === 'off') {
      if (!resting) {
        root.updateWorldMatrix(true, true);
        poseRest();
        resting = true;
        booted = true;
        rootPrev.setFromMatrixPosition(root.matrixWorld);
      }
      return;
    }
    resting = false;

    root.updateWorldMatrix(true, true);
    root.getWorldScale(sScale);
    const worldScale = Math.max(Math.abs(sScale.x), Math.abs(sScale.y), Math.abs(sScale.z)) || 1;
    sRoot.setFromMatrixPosition(root.matrixWorld);

    if (!booted) {
      poseRest();
      booted = true;
      prevDt = 1 / 60;
      acc = 0;
      rootPrev.copy(sRoot);
      return;
    }

    const jump = sRoot.distanceToSquared(rootPrev);
    rootPrev.copy(sRoot);
    if (jump > 0.56) {
      poseRest();
      prevDt = 1 / 60;
      acc = 0;
      return;
    }

    let physics = true;
    let stepDt = dt > 0.05 ? 0.05 : dt;
    if (policy === 'half') {
      acc += dt;
      physics = acc >= (1 / 30) - 0.0005;
      if (!physics) stepDt = 0;
      else {
        stepDt = acc > 0.05 ? 0.05 : acc;
        acc = 0;
      }
    }

    if (!(prevDt > 1e-5)) prevDt = 1 / 60;
    if (physics) stamp++;

    for (let c = 0; c < chains.length; c++) {
      const chain = chains[c];
      const joints = chain.joints;
      if (!chainRuns(chain, policy)) {
        if (chain.live) {
          for (let j = 0; j < joints.length; j++) {
            joints[j].bone.quaternion.copy(joints[j].initialQuat);
            writeBoneMatrix(joints[j].bone);
          }
          chain.live = false;
        }
        continue;
      }
      if (!chain.live) {
        for (let j = 0; j < joints.length; j++) snapTail(joints[j]);
        chain.live = true;
      }
      if (physics) {
        const drag = chain.preset.drag;
        const remain = Math.pow(Math.max(0, 1 - drag), stepDt * 60);
        for (let j = 0; j < joints.length; j++) integrate(joints[j], chain, stepDt, remain, worldScale);
      } else {
        for (let j = 0; j < joints.length; j++) {
          const joint = joints[j];
          const mat = restMatrix(joint);
          sHead.setFromMatrixPosition(mat);
          sDir.copy(joint.localTail).applyMatrix4(mat).sub(sHead);
          const boneLen = sDir.length();
          if (!(boneLen > 1e-6)) continue;
          sDir.multiplyScalar(1 / boneLen);
          sC.copy(joint.currentTail);
          swingClamp(joint.currentTail, sHead, sDir, boneLen, chain.preset.cap);
          sC.subVectors(joint.currentTail, sC);
          joint.prevTail.add(sC);
          aim(joint, joint.currentTail);
        }
      }
    }
    if (physics) prevDt = stepDt;
  }

  function reset() {
    root.updateWorldMatrix(true, true);
    poseRest();
    booted = true;
    resting = false;
    prevDt = 1 / 60;
    acc = 0;
    rootPrev.setFromMatrixPosition(root.matrixWorld);
  }

  const qSample = new THREE.Quaternion();
  function sample() {
    const byKind = { skirt: 0, hair: 0, hairFront: 0, sleeve: 0, tassel: 0 };
    let max = 0;
    let finite = true;
    for (let c = 0; c < chains.length; c++) {
      const id = chains[c].preset.id;
      const joints = chains[c].joints;
      for (let j = 0; j < joints.length; j++) {
        const q = joints[j].bone.quaternion;
        if (!Number.isFinite(q.x) || !Number.isFinite(q.w)) finite = false;
        qSample.copy(joints[j].initialQuat).invert().multiply(q);
        const ang = 2 * Math.acos(Math.min(1, Math.abs(qSample.w))) * 180 / Math.PI;
        if (ang > max) max = ang;
        if (ang > byKind[id]) byKind[id] = ang;
      }
    }
    return { max, byKind, finite };
  }

  function describe() {
    const counts = { bones: boneCount, chains: chains.length, skirt: 0, hair: 0, hairFront: 0, sleeve: 0, tassel: 0 };
    for (let i = 0; i < chains.length; i++) {
      const id = chains[i].preset.id;
      counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  }

  return { update, reset, boneCount, chainCount: chains.length, describe, sample };
}

export { createSpringSet };
