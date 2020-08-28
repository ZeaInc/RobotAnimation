'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var zeaEngine = require('@zeainc/zea-engine');
var zeaUx = require('@zeainc/zea-ux');

/** Class representing an explode part parameter.
 * @extends StructParameter
 * @private
 */
class ExplodePartParameter extends zeaEngine.StructParameter {
  /**
   * Create an explode part parameter.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.__stageParam = this._addMember(new zeaEngine.NumberParameter('Stage', 0));
    this.__axisParam = this._addMember(new zeaEngine.Vec3Parameter('Axis', new zeaEngine.Vec3(1, 0, 0)));

    // The Movement param enables fine level timing to be set per part.
    this.__movementParam = this._addMember(
      new zeaEngine.Vec2Parameter('MovementTiming', new zeaEngine.Vec2(0, 1), [new zeaEngine.Vec2(0, 0), new zeaEngine.Vec2(1, 1)])
    );
    this.__multiplierParam = this._addMember(new zeaEngine.NumberParameter('Multiplier', 1.0));
  }

  /**
   * The getStage method.
   * @return {any} - The return value.
   */
  getStage() {
    return this.__stageParam.getValue()
  }

  /**
   * The setStage method.
   * @param {any} stage - The stage value.
   */
  setStage(stage) {
    this.__stageParam.setValue(stage);
  }

  /**
   * The getOutput method.
   * @return {any} - The return value.
   */
  getOutput() {
    return this.__output
  }

  /**
   * The evaluate method.
   * @param {any} explode - The explode value.
   * @param {any} explodeDist - The distance that the parts explode to.
   * @param {any} offset - The offset value.
   * @param {any} stages - The stages value.
   * @param {any} cascade - In "cascade" mode, the parts move in a cascade.
   * @param {any} centered - The centered value.
   * @param {Xfo} parentXfo - The parentXfo value.
   * @param {any} parentDelta - The parentDelta value.
   */
  evaluate(explode, explodeDist, offset, stages, cascade, centered, parentXfo, parentDelta) {
    // Note: during interactive setup of the operator we
    // can have evaluations before anhthing is connected.
    if (!this.__output.isConnected()) return

    const stage = this.__stageParam.getValue();
    const movement = this.__movementParam.getValue();
    let dist;
    if (cascade) {
      // In 'cascade' mode, the parts move in a cascade,
      // starting with stage 0. then 1 ...
      let t = stage / stages;
      if (centered) t -= 0.5;
      dist = explodeDist * zeaEngine.MathFunctions.linStep(movement.x, movement.y, Math.max(0, explode - t));
    } else {
      // Else all the parts are spread out across the explode distance.
      let t = 1.0 - stage / stages;
      if (centered) t -= 0.5;
      dist = explodeDist * zeaEngine.MathFunctions.linStep(movement.x, movement.y, explode) * t;
    }
    dist += offset;

    let explodeDir = this.__axisParam.getValue();
    const multiplier = this.__multiplierParam.getValue();
    let xfo = this.__output.getValue();
    if (parentXfo) {
      xfo = parentDelta.multiply(xfo);
      explodeDir = parentXfo.ori.rotateVec3(explodeDir);
    }
    xfo.tr.addInPlace(explodeDir.scale(dist * multiplier));
    this.__output.setClean(xfo);
  }

  // ////////////////////////////////////////
  // Persistence

  /**
   * The toJSON method encodes this type as a json object for persistence.
   * @param {object} context - The context value.
   * @return {object} - Returns the json object.
   */
  toJSON(context) {
    const j = super.toJSON(context);
    if (j) {
      j.output = this.__output.toJSON(context);
    }
    return j
  }

  /**
   * The fromJSON method decodes a json object for this type.
   * @param {object} j - The json object this item must decode.
   * @param {object} context - The context value.
   */
  fromJSON(j, context) {
    super.fromJSON(j, context);
    if (j.output) {
      this.__output.fromJSON(j.output, context);
    }
  }
}

/** Class representing an explode parts operator.
 * @extends ParameterOwner
 */
class ExplodePartsOperator extends zeaEngine.Operator {
  /**
   * Create an explode parts operator.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.__stagesParam = this.addParameter(new zeaEngine.NumberParameter('Stages', 0));
    this._explodeParam = this.addParameter(new zeaEngine.NumberParameter('Explode', 0.0, [0, 1]));
    this._distParam = this.addParameter(new zeaEngine.NumberParameter('Dist', 1.0));
    this._offsetParam = this.addParameter(new zeaEngine.NumberParameter('Offset', 0));
    this._cascadeParam = this.addParameter(new zeaEngine.BooleanParameter('Cascade', false));
    this._centeredParam = this.addParameter(new zeaEngine.BooleanParameter('Centered', false));
    this.__parentItemParam = this.addParameter(new zeaEngine.TreeItemParameter('RelativeTo'));
    this.__parentItemParam.on('valueChanged', () => {
      // compute the local xfos
      const parentItem = this.__parentItemParam.getValue();
      if (parentItem)
        this.__invParentSpace = parentItem
          .getParameter('GlobalXfo')
          .getValue()
          .inverse();
      else this.__invParentSpace = undefined;
    });
    this.__parentItemParam.on('treeItemGlobalXfoChanged', () => {
      this.setDirty();
    });

    this.__itemsParam = this.addParameter(new zeaEngine.ListParameter('Parts', ExplodePartParameter));
    this.__itemsParam.on('elementAdded', event => {
      if (event.index > 0) {
        const prevStage = this.__itemsParam.getElement(event.index - 1).getStage();
        event.elem.setStage(prevStage + 1);
        this.__stagesParam.setValue(prevStage + 2);
      } else {
        this.__stagesParam.setValue(1);
      }
      event.elem.__output = new zeaEngine.OperatorOutput('Part' + event.index, zeaEngine.OperatorOutputMode.OP_READ_WRITE);
      this.addOutput(event.elem.getOutput());
      this.setDirty();
    });
    this.__itemsParam.on('elementRemoved', event => {
      this.removeOutput(event.elem.getOutput());
    });

    this.__localXfos = [];
    this.__parts = [];
    this.__stages = 2;
  }

  /**
   * The evaluate method.
   */
  evaluate() {
    // console.log(`Operator: evaluate: ${this.getName()}`)
    const stages = this.__stagesParam.getValue();
    const explode = this._explodeParam.getValue();
    // const explodeDir = this.getParameter('Axis').getValue();
    const explodeDist = this._distParam.getValue();
    const offset = this._offsetParam.getValue();
    const cascade = this._cascadeParam.getValue();
    const centered = this._centeredParam.getValue();
    const parentItem = this.__parentItemParam.getValue();
    let parentXfo;
    let parentDelta;
    if (parentItem) {
      parentXfo = parentItem.getParameter('GlobalXfo').getValue();
      parentDelta = this.__invParentSpace.multiply(parentXfo);
    }

    const items = this.__itemsParam.getValue();
    for (let i = 0; i < items.length; i++) {
      const part = items[i];
      part.evaluate(explode, explodeDist, offset, stages, cascade, centered, parentXfo, parentDelta);
    }
  }

  // ////////////////////////////////////////
  // Persistence

  /**
   * The toJSON method encodes this type as a json object for persistence.
   *
   * @param {object} context - The context value.
   * @return {object} - Returns the json object.
   */
  toJSON(context) {
    return super.toJSON(context)
  }

  /**
   * The fromJSON method decodes a json object for this type.
   * @param {object} j - The json object this item must decode.
   * @param {object} context - The context value.
   */
  fromJSON(j, context) {
    super.fromJSON(j, context);
  }
}

zeaEngine.Registry.register('ExplodePartsOperator', ExplodePartsOperator);

/** Class representing a gear parameter.
 * @extends StructParameter
 */
class GearParameter extends zeaEngine.StructParameter {
  /**
   * Create a gear parameter.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.__ratioParam = this._addMember(new zeaEngine.NumberParameter('Ratio', 1.0));
    this.__offsetParam = this._addMember(new zeaEngine.NumberParameter('Offset', 0.0));
    this.__axisParam = this._addMember(new zeaEngine.Vec3Parameter('Axis', new zeaEngine.Vec3(1, 0, 0)));
  }

  /**
   * The getOutput method.
   * @return {any} - The return value.
   */
  getOutput() {
    return this.__output
  }

  /**
   * Getter for the gear ratio.
   * @return {number} - Returns the ratio.
   */
  getRatio() {
    return this.__ratioParam.getValue()
  }

  /**
   * getter for the gear offset.
   * @return {number} - Returns the offset.
   */
  getOffset() {
    return this.__offsetParam.getValue()
  }

  /**
   * The getAxis method.
   * @return {any} - The return value.
   */
  getAxis() {
    return this.__axisParam.getValue()
  }

  // ////////////////////////////////////////
  // Persistence

  /**
   * The toJSON method encodes this type as a json object for persistence.
   * @param {object} context - The context value.
   * @return {object} - Returns the json object.
   */
  toJSON(context) {
    const j = super.toJSON(context);
    if (j) {
      j.output = this.__output.toJSON(context);
    }
    return j
  }

  /**
   * The fromJSON method decodes a json object for this type.
   * @param {object} j - The json object this item must decode.
   * @param {object} context - The context value.
   */
  fromJSON(j, context) {
    super.fromJSON(j, context);
    if (j.output) {
      this.__output.fromJSON(j.output, context);
    }
  }
}

/**
 * Class representing a gears operator.
 *
 * @extends Operator
 */
class GearsOperator extends zeaEngine.Operator {
  /**
   * Create a gears operator.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.__revolutionsParam = this.addParameter(new zeaEngine.NumberParameter('Revolutions', 0.0));
    const rpmParam = this.addParameter(new zeaEngine.NumberParameter('RPM', 0.0)); // revolutions per minute
    this.__timeoutId;
    rpmParam.on('valueChanged', () => {
      const rpm = rpmParam.getValue();
      if (Math.abs(rpm) > 0.0) {
        if (!this.__timeoutId) {
          const timerCallback = () => {
            const rpm = rpmParam.getValue();
            const revolutions = this.__revolutionsParam.getValue();
            this.__revolutionsParam.setValue(revolutions + rpm * (1 / (50 * 60)));
            this.__timeoutId = setTimeout(timerCallback, 20); // Sample at 50fps.
          };
          timerCallback();
        }
      } else {
        clearTimeout(this.__timeoutId);
        this.__timeoutId = undefined;
      }
    });
    this.__gearsParam = this.addParameter(new zeaEngine.ListParameter('Gears', GearParameter));
    this.__gearsParam.on('elementAdded', event => {
      event.elem.__output = new zeaEngine.OperatorOutput('Gear' + event.index, zeaEngine.OperatorOutputMode.OP_READ_WRITE);
      this.addOutput(event.elem.getOutput());
    });
    this.__gearsParam.on('elementRemoved', event => {
      this.removeOutput(event.index);
    });

    this.__gears = [];
  }

  /**
   * The evaluate method.
   */
  evaluate() {
    // console.log(`Operator: evaluate: ${this.getName()}`)
    const revolutions = this.__revolutionsParam.getValue();
    const gears = this.__gearsParam.getValue();
    gears.forEach((gear, index) => {
      const output = this.getOutputByIndex(index);

      // Note: we have cases where we have interdependencies.
      // Operator A Writes to [A, B, C]
      // Operator B Writes to [A, B, C].
      // During the load of operator B.C, we trigger an evaluation
      // of Operator A, which causes B to evaluate (due to B.A already connected)
      // Now operator B is evaluating will partially setup.
      // See SmartLoc: Exploded Parts and Gears read/write the same set of
      // params.
      if (!output.isConnected()) return

      const rot = revolutions * gear.getRatio() + gear.getOffset();

      const quat = new zeaEngine.Quat();
      quat.setFromAxisAndAngle(gear.getAxis(), rot * Math.PI * 2.0);
      const xfo = output.getValue();
      xfo.ori = quat.multiply(xfo.ori);
      output.setClean(xfo);
    });
  }

  /**
   * The detach method.
   */
  detach() {
    super.detach();
    if (this.__timeoutId) {
      clearTimeout(this.__timeoutId);
      this.__timeoutId = null;
    }
  }

  /**
   * The reattach method.
   */
  reattach() {
    super.reattach();

    // Restart the operator.
    this.getParameter('RPM').emit('valueChanged', {});
  }

  /**
   * The destroy is called by the system to cause explicit resources cleanup.
   * Users should never need to call this method directly.
   */
  destroy() {
    if (this.__timeoutId) {
      clearTimeout(this.__timeoutId);
      this.__timeoutId = null;
    }
    super.destroy();
  }
}

zeaEngine.Registry.register('GearsOperator', GearsOperator);

/** Class representing a piston parameter.
 * @extends StructParameter
 */
class PistonParameter extends zeaEngine.StructParameter {
  /**
   * Create a piston parameter.
   * @param {string} name - The name value.
   */
  constructor() {
    super('Piston');

    // this.__pistonAxisParam = this._addMember(new Vec('Axis', 0));
    this.__pistonAngleParam = this._addMember(new zeaEngine.NumberParameter('PistonAngle', 0));
    this.__camPhaseParam = this._addMember(new zeaEngine.NumberParameter('CamPhase', 0));
    this.__camLengthParam = this._addMember(new zeaEngine.NumberParameter('CamLength', 3));
    this.__rodLengthParam = this._addMember(new zeaEngine.NumberParameter('RodLength', 3));

    // The first RodItem added causes the rodOffset to be computed.
    this.__rodOutput = new zeaEngine.OperatorOutput('Rod', zeaEngine.OperatorOutputMode.OP_READ_WRITE);
    this.__capOutput = new zeaEngine.OperatorOutput('Cap', zeaEngine.OperatorOutputMode.OP_READ_WRITE);

    this.__pistonAngleParam.on('valueChanged', this.init.bind(this));
    this.__camPhaseParam.on('valueChanged', this.init.bind(this));
    this.__camLengthParam.on('valueChanged', this.init.bind(this));
    this.__rodLengthParam.on('valueChanged', this.init.bind(this));

    this.__bindXfos = {};
  }

  /**
   * The getRodOutput method.
   * @return {any} - The return value.
   */
  getRodOutput() {
    return this.__rodOutput
  }

  /**
   * The getCapOutput method.
   * @return {any} - The return value.
   */
  getCapOutput() {
    return this.__capOutput
  }

  /**
   * The setCrankXfo method.
   * @param {Xfo} baseCrankXfo - The baseCrankXfo value.
   */
  setCrankXfo(baseCrankXfo) {
    this.__baseCrankXfo = baseCrankXfo;
    this.init();
  }

  /**
   * The init method.
   */
  init() {
    if (!this.__baseCrankXfo) return

    const camPhase = this.__camPhaseParam.getValue();
    const camLength = this.__camLengthParam.getValue();
    const rodLength = this.__rodLengthParam.getValue();
    const pistonAngle = this.__pistonAngleParam.getValue();
    const crankVec = new zeaEngine.Vec3(
      Math.sin(zeaEngine.MathFunctions.degToRad(pistonAngle)),
      Math.cos(zeaEngine.MathFunctions.degToRad(pistonAngle)),
      0.0
    );
    this.__pistonAxis = this.__baseCrankXfo.ori.rotateVec3(crankVec);

    this.__camVec = this.__baseCrankXfo.ori.rotateVec3(
      new zeaEngine.Vec3(Math.sin(camPhase * 2.0 * Math.PI) * camLength, Math.cos(camPhase * 2.0 * Math.PI) * camLength, 0.0)
    );

    const camAngle = camPhase * 2.0 * Math.PI;
    const bigEndOffset = Math.sin(camAngle) * camLength;
    const headOffset = Math.sqrt(rodLength * rodLength - bigEndOffset * bigEndOffset) + Math.cos(camAngle) * camLength;
    this.__pistonOffset = headOffset;
  }

  /**
   * The evaluate method.
   * @param {Quat} quat - The quat value.
   * @param {any} crankAxis - The crankAxis value.
   * @param {any} revolutions - The revolutions value.
   */
  evaluate(quat, crankAxis, revolutions) {
    const camPhase = this.__camPhaseParam.getValue();
    const camLength = this.__camLengthParam.getValue();
    const rodLength = this.__rodLengthParam.getValue();
    const camAngle = (camPhase + revolutions) * 2.0 * Math.PI;

    const bigEndOffset = Math.sin(camAngle) * camLength;
    const rodAngle = Math.asin(bigEndOffset / rodLength);
    const headOffset = Math.sqrt(rodLength * rodLength - bigEndOffset * bigEndOffset) + Math.cos(camAngle) * camLength;

    if (this.__rodOutput.isConnected()) {
      const rodXfo = this.__rodOutput.getValue();
      const axisPos = rodXfo.tr.subtract(this.__baseCrankXfo.tr).dot(crankAxis);

      const rotRotation = new zeaEngine.Quat();
      rotRotation.setFromAxisAndAngle(crankAxis, -rodAngle);

      rodXfo.tr = this.__baseCrankXfo.tr.add(quat.rotateVec3(this.__camVec));
      rodXfo.tr.addInPlace(crankAxis.scale(axisPos));
      rodXfo.ori = rotRotation.multiply(rodXfo.ori);
      this.__rodOutput.setValue(rodXfo);
    }

    if (this.__capOutput.isConnected()) {
      const headXfo = this.__capOutput.getValue();
      headXfo.tr = headXfo.tr.add(this.__pistonAxis.scale(headOffset - this.__pistonOffset));
      this.__capOutput.setValue(headXfo);
    }
  }

  /**
   * The setOwner method.
   * @param {any} owner - The owner value.
   */
  setOwner(owner) {
    this.__owner = owner;
  }

  /**
   * The getOwner method.
   * @return {any} - The return value.
   */
  getOwner() {
    return this.__owner
  }

  // ////////////////////////////////////////
  // Persistence

  /**
   * The toJSON method encodes this type as a json object for persistence.
   * @param {object} context - The context value.
   * @return {object} - Returns the json object.
   */
  toJSON(context) {
    const j = super.toJSON(context);
    return j
  }

  /**
   * The fromJSON method decodes a json object for this type.
   * @param {object} j - The json object this item must decode.
   * @param {object} context - The context value.
   */
  fromJSON(j, context) {
    super.fromJSON(j, context);
  }

  // ////////////////////////////////////////
  // Clone

  /**
   * The clone method constructs a new piston parameter, copies its values
   * from this parameter and returns it.
   *
   * @return {PistonParameter} - Returns a new cloned piston parameter.
   */
  clone() {
    const clonedParam = new PistonParameter(this.__name, this.__value);
    return clonedParam
  }
}

/** Class representing a piston operator.
 * @extends Operator
 */
class PistonOperator extends zeaEngine.Operator {
  /**
   * Create a piston operator.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.__revolutionsParam = this.addParameter(new zeaEngine.NumberParameter('Revolutions', 0.0, [0, 1]));
    const rpmParam = this.addParameter(new zeaEngine.NumberParameter('RPM', 0.0)); // revolutions per minute
    const fps = 50;
    const sampleTime = 1000 / fps;
    const anglePerSample = 1 / (fps * 60);
    rpmParam.on('valueChanged', () => {
      let rpm = rpmParam.getValue();
      if (rpm > 0.0) {
        if (!this.__timeoutId) {
          const timerCallback = () => {
            rpm = rpmParam.getValue();
            const revolutions = this.__revolutionsParam.getValue();
            this.__revolutionsParam.setValue(revolutions + rpm * anglePerSample);
            this.__timeoutId = setTimeout(timerCallback, sampleTime); // Sample at 50fps.
          };
          timerCallback();
        }
      } else {
        clearTimeout(this.__timeoutId);
        this.__timeoutId = undefined;
      }
    });

    // this.__crankParam = this.addParameter(new KinematicGroupParameter('Crank'));
    this.__crankOutput = this.addOutput(new zeaEngine.OperatorOutput('Crank', zeaEngine.OperatorOutputMode.OP_READ_WRITE));
    this.__crankOutput.on('paramSet', this.init.bind(this));
    this.__crankAxisParam = this.addParameter(new zeaEngine.Vec3Parameter('CrankAxis', new zeaEngine.Vec3(1, 0, 0)));
    this.__crankAxisParam.on('valueChanged', () => {
      // this.__baseCrankXfo.ori.setFromAxisAndAngle(this.__crankAxisParam.getValue(), 0.0);
      this.__baseCrankXfo.ori.setFromDirectionAndUpvector(this.__crankAxisParam.getValue(), new zeaEngine.Vec3(0, 0, 1));
      this.init();
    });
    this.__pistonsParam = this.addParameter(new zeaEngine.ListParameter('Pistons', PistonParameter));
    this.__pistonsParam.on('elementAdded', event => {
      event.elem.setCrankXfo(this.__baseCrankXfo);

      this.addOutput(event.elem.getRodOutput());
      this.addOutput(event.elem.getCapOutput());
    });
    this.__pistonsParam.on('elementRemoved', event => {
      this.removeOutput(event.elem.getRodOutput());
      this.removeOutput(event.elem.getCapOutput());
    });

    this.__baseCrankXfo = new zeaEngine.Xfo();
    this.__pistons = [];
  }

  /**
   * The setOwner method.
   * @param {any} ownerItem - The ownerItem value.
   */
  setOwner(ownerItem) {
    super.setOwner(ownerItem);
  }

  /**
   * The getCrankOutput method.
   * @return {any} - The return value.
   */
  getCrankOutput() {
    return this.__crankOutput
  }

  /**
   * The init method.
   */
  init() {
    const pistons = this.__pistonsParam.getValue();
    for (const piston of pistons) piston.setCrankXfo(this.__baseCrankXfo);

    if (this.__crankOutput.isConnected())
      this.__crankOffset = this.__baseCrankXfo.inverse().multiply(this.__crankOutput.getValue());
  }

  /**
   * The evaluate method.
   */
  evaluate() {
    const revolutions = this.__revolutionsParam.getValue();
    const crankAxis = this.__crankAxisParam.getValue();
    const quat = new zeaEngine.Quat();
    quat.setFromAxisAndAngle(crankAxis, revolutions * Math.PI * 2.0);

    if (this.__crankOutput.isConnected()) {
      const crankXfo = this.__crankOutput.getValue();
      crankXfo.ori = quat.multiply(crankXfo.ori);
      this.__crankOutput.setValue(crankXfo);
    }

    const pistons = this.__pistonsParam.getValue();
    const len = pistons.length;
    for (let i = 0; i < len; i++) {
      const piston = pistons[i];
      piston.evaluate(quat, crankAxis, revolutions);
    }

    this.emit('postEval', {});
  }

  // ////////////////////////////////////////
  // Persistence

  /**
   * The toJSON method encodes this type as a json object for persistence.
   *
   * @param {object} context - The context value.
   * @return {object} - Returns the json object.
   */
  toJSON(context) {
    return super.toJSON(context)
  }

  /**
   * The fromJSON method decodes a json object for this type.
   *
   * @param {object} j - The json object this item must decode.
   * @param {object} context - The context value.
   */
  fromJSON(j, context) {
    super.fromJSON(j, context);
    if (j.crankOutput) {
      this.__crankOutput.fromJSON(j.crankOutput, context);
    }
    this.init();
  }

  /**
   * The destroy is called by the system to cause explicit resources cleanup.
   * Users should never need to call this method directly.
   */
  destroy() {
    clearTimeout(this.__timeoutId);
    super.destroy();
  }
}

zeaEngine.Registry.register('PistonOperator', PistonOperator);

/** An operator for aiming items at targets.
 * @extends Operator
 */
class AimOperator extends zeaEngine.Operator {
  /**
   * Create a gears operator.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.addParameter(new zeaEngine.NumberParameter('Weight', 1));
    this.addParameter(
      new zeaEngine.MultiChoiceParameter('Axis', 0, ['+X Axis', '-X Axis', '+Y Axis', '-Y Axis', '+Z Axis', '-Z Axis'])
    );

    this.addParameter(new zeaEngine.NumberParameter('Stretch', 0.0));
    this.addParameter(new zeaEngine.NumberParameter('Initial Dist', 1.0));
    // this.addParameter(new XfoParameter('Target'))
    this.addInput(new zeaEngine.OperatorInput('Target'));
    this.addOutput(new zeaEngine.OperatorOutput('InputOutput', zeaEngine.OperatorOutputMode.OP_READ_WRITE));
  }

  /**
   * The resetStretchRefDist method.
   */
  resetStretchRefDist() {
    const target = this.getInput('Target').getValue();
    const output = this.getOutputByIndex(0);
    const xfo = output.getValue();
    const dist = target.tr.subtract(xfo.tr).length();
    this.getParameter('Initial Dist').setValue(dist);
  }

  /**
   * The evaluate method.
   */
  evaluate() {
    const weight = this.getParameter('Weight').getValue();
    const axis = this.getParameter('Axis').getValue();
    const target = this.getInput('Target').getValue();
    const output = this.getOutputByIndex(0);
    const xfo = output.getValue();
    const dir = target.tr.subtract(xfo.tr);
    const dist = dir.length();
    if (dist < 0.000001) return
    dir.scaleInPlace(1 / dist);
    let vec;
    switch (axis) {
      case 0:
        vec = xfo.ori.getXaxis();
        break
      case 1:
        vec = xfo.ori.getXaxis().negate();
        break
      case 2:
        vec = xfo.ori.getYaxis();
        break
      case 3:
        vec = xfo.ori.getYaxis().negate();
        break
      case 4:
        vec = xfo.ori.getZaxis();
        break
      case 5:
        vec = xfo.ori.getZaxis().negate();
        break
    }
    let align = new zeaEngine.Quat();
    align.setFrom2Vectors(vec, dir);
    align.alignWith(new zeaEngine.Quat());
    if (weight < 1.0) align = new zeaEngine.Quat().lerp(align, weight);
    xfo.ori = align.multiply(xfo.ori);
    const stretch = this.getParameter('Stretch').getValue();
    if (stretch > 0.0) {
      const initialDist = this.getParameter('Initial Dist').getValue();
      // Scale the output to reach towards the target.
      // Note: once the base xfo is re-calculated, then
      // we can make this scale relative. (e.g. *= sc)
      // This will happen once GalcGlibalXfo is the base
      // operator applied to GlobalXfo param.
      // Until then, we must reset scale manually here.
      const sc = 1.0 + (dist / initialDist - 1.0) * stretch;
      switch (axis) {
        case 0:
        case 1:
          xfo.sc.x = sc;
          break
        case 2:
        case 3:
          xfo.sc.y = sc;
          break
        case 4:
        case 5:
          xfo.sc.z = sc;
          break
      }
      // console.log("AimOperator.evaluate:", xfo.sc.toString())
    }
    output.setClean(xfo);
  }
}

zeaEngine.Registry.register('AimOperator', AimOperator);

/** An operator for aiming items at targets.
 * @extends Operator
 */
class RamAndPistonOperator extends zeaEngine.Operator {
  /**
   * Create a gears operator.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.addParameter(
      new zeaEngine.MultiChoiceParameter('Axis', 0, ['+X Axis', '-X Axis', '+Y Axis', '-Y Axis', '+Z Axis', '-Z Axis'])
    );

    this.addOutput(new zeaEngine.OperatorOutput('Ram', zeaEngine.OperatorOutputMode.OP_READ_WRITE));
    this.addOutput(new zeaEngine.OperatorOutput('Piston', zeaEngine.OperatorOutputMode.OP_READ_WRITE));
  }

  /**
   * The evaluate method.
   */
  evaluate() {
    const ramOutput = this.getOutputByIndex(0);
    const pistonOutput = this.getOutputByIndex(1);
    const ramXfo = ramOutput.getValue();
    const pistonXfo = pistonOutput.getValue();

    const axis = this.getParameter('Axis').getValue();
    const dir = pistonXfo.tr.subtract(ramXfo.tr);
    dir.normalizeInPlace();

    const alignRam = new zeaEngine.Quat();
    const alignPiston = new zeaEngine.Quat();
    switch (axis) {
      case 0:
        alignRam.setFrom2Vectors(ramXfo.ori.getXaxis(), dir);
        alignPiston.setFrom2Vectors(pistonXfo.ori.getXaxis().negate(), dir);
        break
      case 1:
        alignRam.setFrom2Vectors(ramXfo.ori.getXaxis().negate(), dir);
        alignPiston.setFrom2Vectors(pistonXfo.ori.getXaxis(), dir);
        break
      case 2:
        alignRam.setFrom2Vectors(ramXfo.ori.getYaxis(), dir);
        alignPiston.setFrom2Vectors(pistonXfo.ori.getYaxis().negate(), dir);
        break
      case 3:
        alignRam.setFrom2Vectors(ramXfo.ori.getYaxis().negate(), dir);
        alignPiston.setFrom2Vectors(pistonXfo.ori.getYaxis(), dir);
        break
      case 4:
        alignRam.setFrom2Vectors(ramXfo.ori.getZaxis(), dir);
        alignPiston.setFrom2Vectors(pistonXfo.ori.getZaxis().negate(), dir);
        break
      case 5:
        alignRam.setFrom2Vectors(ramXfo.ori.getZaxis().negate(), dir);
        alignPiston.setFrom2Vectors(pistonXfo.ori.getZaxis(), dir);
        break
    }

    ramXfo.ori = alignRam.multiply(ramXfo.ori);
    pistonXfo.ori = alignPiston.multiply(pistonXfo.ori);

    ramOutput.setClean(ramXfo);
    pistonOutput.setClean(pistonXfo);
  }
}

zeaEngine.Registry.register('RamAndPistonOperator', RamAndPistonOperator);

/** An operator for aiming items at targets.
 * @extends Operator
 */
class TriangleIKSolver extends zeaEngine.Operator {
  /**
   * Create a gears operator.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);
    // this.addParameter(
    //   new MultiChoiceParameter('Axis', 0, ['+X Axis', '-X Axis', '+Y Axis', '-Y Axis', '+Z Axis', '-Z Axis'])
    // )
    this.addInput(new zeaEngine.OperatorInput('Target'));
    this.addOutput(new zeaEngine.OperatorOutput('Joint0', zeaEngine.OperatorOutputMode.OP_READ_WRITE));
    this.addOutput(new zeaEngine.OperatorOutput('Joint1', zeaEngine.OperatorOutputMode.OP_READ_WRITE));
    this.align = new zeaEngine.Quat();
    this.enabled = false;
  }

  enable() {
    const targetXfo = this.getInput('Target').getValue();
    const joint0Xfo = this.getOutput('Joint0').getValue();
    const joint1Xfo = this.getOutput('Joint1').getValue();
    this.joint1Offset = joint0Xfo.inverse().multiply(joint1Xfo).tr;
    this.joint1TargetOffset = joint1Xfo.inverse().multiply(targetXfo).tr;
    this.joint1TargetOffset.normalizeInPlace();
    this.joint0Length = joint1Xfo.tr.distanceTo(joint0Xfo.tr);
    this.joint1Length = targetXfo.tr.distanceTo(joint1Xfo.tr);
    this.setDirty();
    this.enabled = true;
  }

  /**
   * The evaluate method.
   */
  evaluate() {
    const targetXfo = this.getInput('Target').getValue();
    const joint0Output = this.getOutput('Joint0');
    const joint1Output = this.getOutput('Joint1');
    const joint0Xfo = joint0Output.getValue();
    const joint1Xfo = joint1Output.getValue();

    ///////////////////////////////
    // Calc joint0Xfo
    const joint0TargetVec = targetXfo.tr.subtract(joint0Xfo.tr);
    const joint0TargetDist = joint0TargetVec.length();
    const joint01Vec = joint0Xfo.ori.rotateVec3(this.joint1Offset);

    // Calculate the angle using the rule of cosines.
    // cos C	= (a2 + b2 − c2)/2ab
    const a = this.joint0Length;
    const b = joint0TargetDist;
    const c = this.joint1Length;
    const angle = Math.acos((a * a + b * b - c * c) / (2 * a * b));

    // console.log(currAngle, angle)

    joint01Vec.normalizeInPlace();
    joint0TargetVec.normalizeInPlace();

    const Joint0Axis = joint0TargetVec.cross(joint01Vec);
    const currAngle = joint0TargetVec.angleTo(joint01Vec);
    Joint0Axis.normalizeInPlace();

    this.align.setFromAxisAndAngle(Joint0Axis, angle - currAngle);
    joint0Xfo.ori = this.align.multiply(joint0Xfo.ori);

    ///////////////////////////////
    // Calc joint1Xfo
    joint1Xfo.tr = joint0Xfo.transformVec3(this.joint1Offset);

    const joint1TargetVec = targetXfo.tr.subtract(joint1Xfo.tr);
    joint1TargetVec.normalizeInPlace();
    this.align.setFrom2Vectors(joint1Xfo.ori.rotateVec3(this.joint1TargetOffset), joint1TargetVec);
    joint1Xfo.ori = this.align.multiply(joint1Xfo.ori);

    ///////////////////////////////
    // Done
    joint0Output.setClean(joint0Xfo);
    joint1Output.setClean(joint1Xfo);
  }
}

zeaEngine.Registry.register('TriangleIKSolver', TriangleIKSolver);

const X_AXIS = new zeaEngine.Vec3(1, 0, 0);
const Y_AXIS = new zeaEngine.Vec3(0, 1, 0);
const Z_AXIS = new zeaEngine.Vec3(0, 0, 1);
const identityXfo = new zeaEngine.Xfo();
const identityQuat = new zeaEngine.Quat();

const generateDebugLines = (debugTree, color) => {
  const line = new zeaEngine.Lines();
  const linepositions = line.getVertexAttribute('positions');

  const mat = new zeaEngine.Material('debug', 'LinesShader');
  mat.getParameter('BaseColor').setValue(new zeaEngine.Color(color));
  mat.getParameter('Overlay').setValue(1);

  const debugGeomItem = new zeaEngine.GeomItem('Pointer', line, mat);
  debugTree.addChild(debugGeomItem);

  let numDebugSegments = 0;
  let numDebugPoints = 0;

  return {
    addDebugSegment: (p0, p1) => {
      const pid0 = numDebugPoints;
      const pid1 = numDebugPoints + 1;
      numDebugSegments++;
      numDebugPoints += 2;
      if (line.getNumVertices() < numDebugPoints) line.setNumVertices(numDebugPoints);
      if (line.getNumSegments() < numDebugSegments) line.setNumSegments(numDebugSegments);
      line.setSegmentVertexIndices(numDebugSegments - 1, pid0, pid1);
      linepositions.getValueRef(pid0).setFromOther(p0);
      linepositions.getValueRef(pid1).setFromOther(p1);
    },
    doneFrame: () => {
      line.emit('geomDataTopologyChanged');
      numDebugSegments = 0;
      numDebugPoints = 0;
    }
  }
};

class IKJoint {
  constructor(index, axisId = 0, limits, solverDebugTree) {
    this.index = index;
    this.axisId = axisId;
    this.limits = [zeaEngine.MathFunctions.degToRad(limits[0]), zeaEngine.MathFunctions.degToRad(limits[1])];
    this.align = new zeaEngine.Quat();

    this.debugTree = new zeaEngine.TreeItem('IKJoint' + index);
    solverDebugTree.addChild(this.debugTree);
    this.debugLines = {};
  }

  addDebugSegment(color, p0, p1) {
    if (!this.debugLines[color]) {
      this.debugLines[color] = generateDebugLines(this.debugTree, color);
    }
    this.debugLines[color].addDebugSegment(p0, p1);
  }

  init(parentXfo) {
    this.xfo = this.output.getValue().clone(); // until we have an IO output
    this.localXfo = parentXfo.inverse().multiply(this.xfo);
    this.bindLocalXfo = this.localXfo.clone();

    switch (this.axisId) {
      case 0:
        this.axis = X_AXIS;
        break
      case 1:
        this.axis = Y_AXIS;
        break
      case 2:
        this.axis = Z_AXIS;
        break
    }
  }

  preEval(parentXfo) {
    this.xfo.ori = parentXfo.ori.multiply(this.bindLocalXfo.ori);
    this.xfo.tr = parentXfo.tr.add(parentXfo.ori.rotateVec3(this.bindLocalXfo.tr));
  }

  evalCCD(baseXfo, targetXfo, index, joints) {
    if (index == joints.length - 1) {
      this.xfo.ori = targetXfo.ori.clone();
    } else {
      {
        const targetVec = targetXfo.tr.subtract(this.xfo.tr);
        const jointToTip = joints[joints.length - 1].xfo.tr.subtract(this.xfo.tr);
        this.align.setFrom2Vectors(jointToTip.normalize(), targetVec.normalize());
        this.xfo.ori = this.align.multiply(this.xfo.ori);
        // this.addDebugSegment('#FF0000', this.xfo.tr, this.xfo.tr.add(jointToTip))
        // this.addDebugSegment('#FFFF00', this.xfo.tr, this.xfo.tr.add(targetVec))
      }
    }

    ///////////////////////
    // Apply joint constraint.
    if (index > 0) {
      this.align.setFrom2Vectors(this.xfo.ori.rotateVec3(this.axis), joints[index - 1].xfo.ori.rotateVec3(this.axis));
      const parentJoint = joints[index - 1];
      const parentAlign = this.align.conjugate();
      // parentJoint.xfo.ori = parentAlign.multiply(parentJoint.xfo.ori)
      if (index == joints.length - 1) {
        parentJoint.xfo.ori = parentAlign.multiply(parentJoint.xfo.ori);
      } else {
        parentJoint.xfo.ori = parentAlign.lerp(identityQuat, 0.5).multiply(parentJoint.xfo.ori);
        this.xfo.ori = this.align.lerp(identityQuat, 0.5).multiply(this.xfo.ori);
      }
    } else {
      this.align.setFrom2Vectors(this.xfo.ori.rotateVec3(this.axis), baseXfo.ori.rotateVec3(this.axis));
      this.xfo.ori = this.align.multiply(this.xfo.ori);
    }

    ///////////////////////
    // Apply angle Limits.
    {
      const parentXfo = index > 0 ? joints[index - 1].xfo : baseXfo;
      // const currAngle = Math.acos(this.xfo.ori.dot(parentXfo.ori))
      const deltaQuat = parentXfo.ori.inverse().multiply(this.xfo.ori);
      let currAngle = deltaQuat.w < 1.0 ? deltaQuat.getAngle() : 0.0;
      const deltaAxis = new zeaEngine.Vec3(deltaQuat.x, deltaQuat.y, deltaQuat.x);
      // deltaAxis.normalizeInPlace()
      if (deltaAxis.dot(this.axis) < 0.0) currAngle = -currAngle;
      if (currAngle < this.limits[0] || currAngle > this.limits[1]) {
        const globalAxis = this.xfo.ori.rotateVec3(this.axis);
        const deltaAngle = currAngle < this.limits[0] ? this.limits[0] - currAngle : this.limits[1] - currAngle;
        this.align.setFromAxisAndAngle(globalAxis, deltaAngle);
        this.xfo.ori = this.xfo.ori.multiply(this.align);
      }
    }

    this.xfo.ori.normalizeInPlace();

    if (index > 0) {
      this.localXfo.ori = joints[index - 1].xfo.ori.inverse().multiply(this.xfo.ori);
      this.localXfo.ori.normalizeInPlace();
    }

    {
      let parentXfo = this.xfo;
      for (let i = index + 1; i < joints.length; i++) {
        const joint = joints[i];
        joint.xfo.ori = parentXfo.ori.multiply(joint.localXfo.ori);
        joint.xfo.tr = parentXfo.tr.add(parentXfo.ori.rotateVec3(joint.localXfo.tr));
        parentXfo = joint.xfo;
      }
    }
  }

  setClean() {
    for (let key in this.debugLines) this.debugLines[key].doneFrame();
    this.output.setClean(this.xfo);
  }
}

/** An operator for aiming items at targets.
 * @extends Operator
 */
class IKSolver extends zeaEngine.Operator {
  /**
   * Create a gears operator.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.addParameter(new zeaEngine.NumberParameter('Iterations', 40));
    this.addInput(new zeaEngine.OperatorInput('Base'));
    this.addInput(new zeaEngine.OperatorInput('Target'));
    this.__joints = [];
    this.enabled = false;

    this.debugTree = new zeaEngine.TreeItem('IKSolver-debug');
  }

  addJoint(globalXfoParam, axisId = 0, limits = [-180, 180]) {
    const joint = new IKJoint(this.__joints.length, axisId, limits, this.debugTree);

    const output = this.addOutput(new zeaEngine.OperatorOutput('Joint' + this.__joints.length));
    output.setParam(globalXfoParam);
    joint.output = output;

    this.__joints.push(joint);
    return joint
  }

  enable() {
    const baseXfo = this.getInput('Base').isConnected() ? this.getInput('Base').getValue() : identityXfo;
    this.__joints.forEach((joint, index) => {
      const parentXfo = index > 0 ? this.__joints[index - 1].xfo : baseXfo;
      joint.init(parentXfo);
    });
    this.enabled = true;
    this.setDirty();
  }

  /**
   * The evaluate method.
   */
  evaluate() {
    if (!this.enabled) {
      this.__joints.forEach(joint => {
        joint.output.setClean(joint.output.getValue()); // until we have an IO output
      });
      return
    }
    const targetXfo = this.getInput('Target').getValue();
    const baseXfo = this.getInput('Base').isConnected() ? this.getInput('Base').getValue() : identityXfo;

    const iterations = this.getParameter('Iterations').getValue();
    const numJoints = this.__joints.length;

    // for (let i = 0; i < numJoints; i++) {
    //   const parentXfo = i > 0 ? this.__joints[i - 1].xfo : baseXfo
    //   this.__joints[i].preEval(parentXfo)
    // }

    for (let i = 0; i < iterations; i++) {
      {
        for (let j = numJoints - 1; j >= 0; j--) {
          const joint = this.__joints[j];
          joint.evalCCD(baseXfo, targetXfo, j, this.__joints);
        }
      }
    }

    // Now store the value to the connected Xfo parameter.
    for (let i = 0; i < numJoints; i++) {
      this.__joints[i].setClean();
    }
  }
}

zeaEngine.Registry.register('IKSolver', IKSolver);

/** An operator for aiming items at targets.
 * @extends Operator
 */
class AttachmentConstraint extends zeaEngine.Operator {
  /**
   * Create a gears operator.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.addInput(new zeaEngine.OperatorInput('Time'));
    this.addOutput(new zeaEngine.OperatorOutput('Attached', zeaEngine.OperatorOutputMode.OP_READ_WRITE));

    this.__attachTargets = [];
    this.__attachId = -1;
  }

  addAttachTarget(target, time) {
    const input = this.addInput(new zeaEngine.OperatorInput('Target' + this.getNumInputs()));
    input.setParam(target);

    this.__attachTargets.push({
      input,
      time,
      offsetXfo: undefined
    });
  }

  getAttachTarget(attachId) {
    return this.getInputByIndex(attachId + 1)
  }

  findTarget(time) {
    if (this.__attachTargets.length == 0 || time <= this.__attachTargets[0].time) {
      return -1
    }
    const numKeys = this.__attachTargets.length;
    if (time >= this.__attachTargets[numKeys - 1].time) {
      return numKeys - 1
    }
    // Find the first key after the specified time value
    for (let i = 1; i < numKeys; i++) {
      const key = this.__attachTargets[i];
      if (key.time > time) {
        return i - 1
      }
    }
  }

  /**
   * The evaluate method.
   */
  evaluate() {
    const time = this.getInput('Time').getValue();
    const output = this.getOutputByIndex(0);
    let xfo = output.getValue();

    const attachId = this.findTarget(time);
    if (attachId != -1) {
      const currXfo = this.getAttachTarget(attachId).getValue();
      const attachment = this.__attachTargets[attachId];

      if (attachId != this.__attachId) {
        if (!attachment.offsetXfo) {
          if (this.__attachId == -1) {
            attachment.offsetXfo = currXfo.inverse().multiply(xfo);
          } else {
            const prevXfo = this.getAttachTarget(this.__attachId).getValue();
            const prevOffset = this.__attachTargets[this.__attachId].offsetXfo;
            const offsetXfo = currXfo.inverse().multiply(prevXfo.multiply(prevOffset));
            attachment.offsetXfo = offsetXfo;
          }
        }
        this.__attachId = attachId;
      }

      xfo = currXfo.multiply(attachment.offsetXfo);
    }

    output.setClean(xfo);
  }
}

zeaEngine.Registry.register('AttachmentConstraint', AttachmentConstraint);

/** Class representing a gear parameter.
 * @extends BaseTrack
 */
class BaseTrack extends zeaEngine.EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.keys = [];
    this.__sampleCache = {};

    this.__currChange = null;
    this.__secondaryChange = null;
    this.__secondaryChangeTime = -1;
  }

  getName() {
    return this.name
  }

  getNumKeys() {
    return this.keys.length
  }

  getKeyTime(index) {
    return this.keys[index].time
  }

  getKeyValue(index) {
    return this.keys[index].value
  }

  setKeyValue(index, value) {
    this.keys[index].value = value;
    this.emit('keyChanged', { index });
  }

  getTimeRange() {
    if (this.keys.length == 0) {
      return new zeaEngine.Vec2(Number.NaN, Number.NaN)
    }
    const numKeys = this.keys.length;
    return new zeaEngine.Vec2(this.keys[0].time, this.keys[numKeys - 1].time)
  }

  addKey(time, value) {
    let index;
    const numKeys = this.keys.length;
    if (this.keys.length == 0 || time < this.keys[0].time) {
      this.keys.splice(0, 0, { time, value });
      index = 0;
    } else {
      if (time > this.keys[numKeys - 1].time) {
        this.keys.push({ time, value });
        index = numKeys;
      } else {
        // Find the first key after the specified time value
        for (let i = 1; i < numKeys; i++) {
          const key = this.keys[i];
          if (key.time > time) {
            this.keys.splice(i, 0, { time, value });
            index = i;
            break
          }
        }
      }
    }

    this.emit('keysIndicesChanged', { range: [index, numKeys], delta: 1 });
    this.emit('keyAdded', { index });
    return index
  }

  removeKey(index) {
    // const undoRedoManager = UndoRedoManager.getInstance()
    // const change = undoRedoManager.getCurrentChange()
    // if (change) {
    //   if (this.__currChange != change || this.__secondaryChangeTime != time) {
    //     this.__currChange = change
    //     this.__secondaryChangeTime = time
    //   }
    // }
    this.keys.splice(index, 1);
    const numKeys = this.keys.length;
    this.emit('keysIndicesChanged', { range: [index, numKeys], delta: -1 });
    this.emit('keyRemoved', { index });
  }

  findKeyAndLerp(time) {
    if (this.keys.length == 0) {
      return {
        keyIndex: -1,
        lerp: 0
      }
    }
    if (time <= this.keys[0].time) {
      return {
        keyIndex: 0,
        lerp: 0
      }
    }
    const numKeys = this.keys.length;
    if (time >= this.keys[numKeys - 1].time) {
      return {
        keyIndex: numKeys - 1,
        lerp: 0
      }
    }
    // Find the first key after the specified time value
    for (let i = 1; i < numKeys; i++) {
      const key = this.keys[i];
      if (key.time > time) {
        const prevKey = this.keys[i - 1];
        const delta = key.time - prevKey.time;
        return {
          keyIndex: i - 1,
          lerp: (time - prevKey.time) / delta
        }
      }
    }
  }

  evaluate(time) {
    const keyAndLerp = this.findKeyAndLerp(time);
  }

  setValue(time, value) {
    // const undoRedoManager = UndoRedoManager.getInstance()
    // const change = undoRedoManager.getCurrentChange()
    // if (change) {
    //   if (this.__currChange != change || this.__secondaryChangeTime != time) {
    //     this.__currChange = change
    //     this.__secondaryChangeTime = time

    //     const keyAndLerp = this.findKeyAndLerp(time)
    //     if (keyAndLerp.lerp > 0.0) {
    //       this.__secondaryChange = new AddKeyChange(this, time, value)
    //       this.__currChange.secondaryChanges.push(this.__secondaryChange)
    //     } else {
    //       this.__secondaryChange = new KeyChange(this, keyAndLerp.keyIndex, value)
    //       this.__currChange.secondaryChanges.push(this.__secondaryChange)
    //     }
    //   } else {
    //     this.__secondaryChange.update(value)
    //   }
    // }

    const keyAndLerp = this.findKeyAndLerp(time);
    if (keyAndLerp.lerp > 0.0) {
      this.addKey(time, value);
    } else {
      this.setKeyValue(keyAndLerp.keyIndex, value);
    }
  }

  // ////////////////////////////////////////
  // Persistence

  /**
   * Encodes the current object as a json object.
   *
   * @param {object} context - The context value.
   * @return {object} - Returns the json object.
   */
  toJSON(context) {
    const j = {};
    j.name = this.name;
    j.type = zeaEngine.Registry.getBlueprintName(this);
    j.keys = this.keys.map(key => {
      return { time: key.time, value: key.value.toJSON ? key.value.toJSON() : key.value }
    });
    return j
  }

  /**
   * Decodes a json object for this type.
   *
   * @param {object} j - The json object this item must decode.
   * @param {object} context - The context value.
   */
  fromJSON(j, context) {
    this.__name = j.name;
    this.keys = j.keys.map(keyJson => this.loadKeyJSON(keyJson));
    this.emit('loaded');
  }

  loadKeyJSON(json) {
    const key = {
      time: json.time,
      value: json.value
    };
    return key
  }
}

class ColorTrack extends BaseTrack {
  constructor(name) {
    super(name);
  }

  evaluate(time) {
    const keyAndLerp = this.findKeyAndLerp(time);

    const value0 = this.keys[keyAndLerp.keyIndex].value;
    if (keyAndLerp.lerp > 0.0) {
      const value1 = this.keys[keyAndLerp.keyIndex + 1].value;
      return value0.lerp(value1, keyAndLerp.lerp)
    } else {
      return value0
    }
  }
}

class XfoTrack extends BaseTrack {
  constructor(name) {
    super(name);
  }

  evaluate(time) {
    const keyAndLerp = this.findKeyAndLerp(time);

    const value0 = this.keys[keyAndLerp.keyIndex].value;
    if (keyAndLerp.lerp > 0.0) {
      const value1 = this.keys[keyAndLerp.keyIndex + 1].value;
      const tr = value0.tr.lerp(value1.tr, keyAndLerp.lerp);
      const ori = value0.ori.lerp(value1.ori, keyAndLerp.lerp);
      return new zeaEngine.Xfo(tr, ori)
    } else {
      return value0
    }
  }

  loadKeyJSON(json) {
    const key = {
      time: json.time,
      value: new zeaEngine.Xfo()
    };
    key.value.fromJSON(json.value);
    return key
  }
}

zeaEngine.Registry.register('XfoTrack', XfoTrack);

class AddKeyChange extends zeaUx.Change {
  constructor(track, time, value) {
    super(`Add Key to ${track.getName()}`);
    this.track = track;
    this.time = time;
    this.value = value;
    this.index = track.addKey(time, value);
  }

  update(value) {
    this.value = value;
    this.track.setKeyValue(this.index, this.value);
  }

  undo() {
    this.track.removeKey(this.index);
  }

  redo() {
    this.track.addKey(this.time, this.value);
  }
}

zeaUx.UndoRedoManager.registerChange('AddKeyChange', AddKeyChange);

class KeyChange extends zeaUx.Change {
  constructor(track, index, value) {
    super();
    this.track = track;
    this.index = index;
    this.prevValue = this.track.getKeyValue(this.index);
    this.newValue = value;
    this.track.setKeyValue(this.index, value);
  }

  update(value) {
    this.newValue = value;
    this.track.setKeyValue(this.index, this.newValue);
  }

  undo() {
    this.track.setKeyValue(this.index, this.prevValue);
  }

  redo() {
    this.track.setKeyValue(this.index, this.newValue);
  }
}

zeaUx.UndoRedoManager.registerChange('KeyChange', KeyChange);

/** An operator for aiming items at targets.
 * @extends Operator
 */
class TrackSampler extends zeaEngine.Operator {
  /**
   * Create a TrackSampler operator.
   * @param {string} name - The name value.
   */
  constructor(name, track) {
    super(name);

    this.track = track;
    this.track.on('keyAdded', this.setDirty.bind(this));
    this.track.on('keyRemoved', this.setDirty.bind(this));
    this.track.on('keyChanged', this.setDirty.bind(this));

    this.addInput(new zeaEngine.OperatorInput('Time'));
    this.addOutput(new zeaEngine.OperatorOutput('Output', zeaEngine.OperatorOutputMode.OP_WRITE));

    this.__currChange = null;
    this.__secondaryChange = null;
    this.__secondaryChangeTime = -1;
  }

  /**
   * @param {Xfo} value - The value param.
   * @return {any} - The modified value.
   */
  backPropagateValue(value) {
    const time = this.getInput('Time').getValue();
    // this.track.setValue(time, value)

    const undoRedoManager = zeaUx.UndoRedoManager.getInstance();
    const change = undoRedoManager.getCurrentChange();
    if (change) {
      if (this.__currChange != change || this.__secondaryChangeTime != time) {
        this.__currChange = change;
        this.__secondaryChangeTime = time;

        const keyAndLerp = this.track.findKeyAndLerp(time);
        if (
          keyAndLerp.keyIndex == -1 ||
          keyAndLerp.lerp > 0.0 ||
          (keyAndLerp.keyIndex == this.track.getNumKeys() - 1 && this.track.getKeyTime(keyAndLerp.keyIndex) != time)
        ) {
          this.__secondaryChange = new AddKeyChange(this.track, time, value);
          this.__currChange.secondaryChanges.push(this.__secondaryChange);
        } else {
          this.__secondaryChange = new KeyChange(this.track, keyAndLerp.keyIndex, value);
          this.__currChange.secondaryChanges.push(this.__secondaryChange);
        }
      } else {
        this.__secondaryChange.update(value);
      }
    }

    return value
  }

  /**
   * The evaluate method.
   */
  evaluate() {
    const output = this.getOutputByIndex(0);
    if (this.track.getNumKeys() == 0) {
      output.setClean(output.getValue());
    } else {
      const time = this.getInput('Time').getValue();

      const xfo = this.track.evaluate(time);
      output.setClean(xfo);
    }
  }
}

/** An operator for aiming items at targets.
 * @extends Operator
 */
class KeyDisplayOperator extends zeaEngine.Operator {
  /**
   * Create a gears operator.
   * @param {BaseTrack} track - The track value.
   * @param {number} keyIndex - The index of the key in the track
   */
  constructor(track, keyIndex) {
    super(name);

    this.addOutput(new zeaEngine.OperatorOutput('KeyLocal', zeaEngine.OperatorOutputMode.OP_WRITE));

    this.track = track;
    this.keyIndex = keyIndex;
    this.track.on('keyChanged', event => {
      if (event.index == this.keyIndex) this.setDirty();
    });
    this.track.on('keysIndicesChanged', event => {
      const { range, delta } = event;
      if (this.keyIndex > range[0] && this.keyIndex < range[1]) {
        // this.keyIndex += delta
        this.setDirty();
      }
    });
    this.track.on('keyRemoved', event => {
      const { index } = event;
      if (this.keyIndex >= index) {
        this.setDirty();
      }
    });
  }

  backPropagateValue(value) {
    this.track.setKeyValue(this.keyIndex, value);
  }

  /**
   * The evaluate method.
   */
  evaluate() {
    this.getOutputByIndex(0).setClean(this.track.getKeyValue(this.keyIndex));
  }
}

/** An operator for aiming items at targets.
 * @extends Operator
 */
class XfoTrackDisplay extends zeaEngine.GeomItem {
  /**
   * Create a TrackDisplay operator.
   * @param {string} name - The name value.
   * @param {BaseTrack} track - The track to display.
   */
  constructor(track) {
    super(track.getName());

    this.track = track;

    this.getParameter('Geometry').setValue(new zeaEngine.Lines());

    const linesMat = new zeaEngine.Material('trackLine', 'FlatSurfaceShader');
    linesMat.getParameter('BaseColor').setValue(new zeaEngine.Color(0.3, 0.3, 0.3));
    this.getParameter('Material').setValue(linesMat);

    const dotsMat = new zeaEngine.Material('trackDots', 'PointsShader');
    dotsMat.getParameter('BaseColor').setValue(new zeaEngine.Color(0.75, 0.75, 0.75));
    this.dotsItem = new zeaEngine.GeomItem('dots', new zeaEngine.Points(), dotsMat);
    this.addChild(this.dotsItem);

    try {
      this.__keyMat = new zeaEngine.Material('trackLine', 'HandleShader');
      this.__keyMat.getParameter('maintainScreenSize').setValue(1);
      this.__keyCube = new zeaEngine.Cuboid(0.004, 0.004, 0.004);
    } catch (error) {
      this.__keyMat = new zeaEngine.Material('trackLine', 'SimpleSurfaceShader');
      this.__keyCube = new zeaEngine.Cuboid(0.01, 0.01, 0.01);
    }

    this.__keys = [];
    this.__updatePath();
    this.__displayKeys();

    this.track.on('keyAdded', event => {
      this.__displayKeys();
      this.__updatePath();
    });
    this.track.on('keyRemoved', event => {
      const handle = this.__keys.pop();
      this.removeChild(this.getChildIndex(handle));
      this.__displayKeys();
      this.__updatePath();
    });
    this.track.on('keyChanged', event => {
      this.__updatePath();
    });
    this.track.on('loaded', event => {
      this.__updatePath();
      this.__displayKeys();
    });
  }

  __displayKeys() {
    const displayKey = index => {
      if (!this.__keys[index]) {
        const handle = new zeaEngine.GeomItem('key' + index, this.__keyCube, this.__keyMat);
        this.addChild(handle);
        const keyDisplay = new KeyDisplayOperator(this.track, index);
        keyDisplay.getOutput('KeyLocal').setParam(handle.getParameter('LocalXfo'));
        this.__keys.push(handle);
      }
    };

    const numKeys = this.track.getNumKeys();
    for (let i = 0; i < numKeys; i++) {
      displayKey(i);
    }
  }

  __updatePath() {
    const trackLines = this.getParameter('Geometry').getValue();
    const trackDots = this.dotsItem.getParameter('Geometry').getValue();

    const timeRange = this.track.getTimeRange();
    if (Number.isNaN(timeRange.x) || Number.isNaN(timeRange.y)) return

    const numSamples = Math.round((timeRange.y - timeRange.x) / 50); // Display at 50 samples per second
    if (numSamples == 0) return

    trackLines.setNumVertices(numSamples + 1);
    trackLines.setNumSegments(numSamples);

    trackDots.setNumVertices(numSamples + 1);
    const linePositions = trackLines.getVertexAttribute('positions');
    const dotPositions = trackDots.getVertexAttribute('positions');
    for (let i = 0; i <= numSamples; i++) {
      if (i < numSamples) trackLines.setSegmentVertexIndices(i, i, i + 1);
      const time = timeRange.x + (timeRange.y - timeRange.x) * (i / numSamples);
      const xfo = this.track.evaluate(time);
      linePositions.getValueRef(i).setFromOther(xfo.tr);
      dotPositions.getValueRef(i).setFromOther(xfo.tr);
    }

    trackDots.setBoundingBoxDirty();
    trackDots.emit('geomDataTopologyChanged', {});

    trackLines.setBoundingBoxDirty();
    trackLines.emit('geomDataTopologyChanged', {});
  }
}

class RemoveKeyChange extends zeaUx.Change {
  constructor(track, index) {
    super();
    this.track = track;
    this.index = index;
    this.time = track.getKeyTime(index);
    this.value = track.getKeyValue(index);
    this.track.removeKey(this.index);
  }

  undo() {
    this.track.addKey(this.time, this.value);
  }

  redo() {
    this.track.removeKey(this.index);
  }
}

zeaUx.UndoRedoManager.registerChange('RemoveKeyChange', RemoveKeyChange);

exports.AddKeyChange = AddKeyChange;
exports.AimOperator = AimOperator;
exports.AttachmentConstraint = AttachmentConstraint;
exports.ColorTrack = ColorTrack;
exports.ExplodePartsOperator = ExplodePartsOperator;
exports.GearsOperator = GearsOperator;
exports.IKSolver = IKSolver;
exports.KeyChange = KeyChange;
exports.PistonOperator = PistonOperator;
exports.RamAndPistonOperator = RamAndPistonOperator;
exports.RemoveKeyChange = RemoveKeyChange;
exports.TrackSampler = TrackSampler;
exports.TriangleIKSolver = TriangleIKSolver;
exports.XfoTrack = XfoTrack;
exports.XfoTrackDisplay = XfoTrackDisplay;
