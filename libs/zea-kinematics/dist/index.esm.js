import { Operator, NumberParameter, BooleanParameter, TreeItemParameter, ListParameter, OperatorOutput, OperatorOutputMode, Registry, StructParameter, Vec3Parameter, Vec3, Vec2Parameter, Vec2, MathFunctions, Quat, Xfo, MultiChoiceParameter, OperatorInput, EventEmitter, GeomItem, Lines, Material, Color, Points, Cuboid } from '@zeainc/zea-engine';

/** Class representing an explode part parameter.
 * @extends StructParameter
 * @private
 */
class ExplodePartParameter extends StructParameter {
  /**
   * Create an explode part parameter.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.__stageParam = this._addMember(new NumberParameter('Stage', 0));
    this.__axisParam = this._addMember(new Vec3Parameter('Axis', new Vec3(1, 0, 0)));

    // The Movement param enables fine level timing to be set per part.
    this.__movementParam = this._addMember(
      new Vec2Parameter('MovementTiming', new Vec2(0, 1), [new Vec2(0, 0), new Vec2(1, 1)])
    );
    this.__multiplierParam = this._addMember(new NumberParameter('Multiplier', 1.0));
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
      dist = explodeDist * MathFunctions.linStep(movement.x, movement.y, Math.max(0, explode - t));
    } else {
      // Else all the parts are spread out across the explode distance.
      let t = 1.0 - stage / stages;
      if (centered) t -= 0.5;
      dist = explodeDist * MathFunctions.linStep(movement.x, movement.y, explode) * t;
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
class ExplodePartsOperator extends Operator {
  /**
   * Create an explode parts operator.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.__stagesParam = this.addParameter(new NumberParameter('Stages', 0));
    this._explodeParam = this.addParameter(new NumberParameter('Explode', 0.0, [0, 1]));
    this._distParam = this.addParameter(new NumberParameter('Dist', 1.0));
    this._offsetParam = this.addParameter(new NumberParameter('Offset', 0));
    this._cascadeParam = this.addParameter(new BooleanParameter('Cascade', false));
    this._centeredParam = this.addParameter(new BooleanParameter('Centered', false));
    this.__parentItemParam = this.addParameter(new TreeItemParameter('RelativeTo'));
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

    this.__itemsParam = this.addParameter(new ListParameter('Parts', ExplodePartParameter));
    this.__itemsParam.on('elementAdded', event => {
      if (event.index > 0) {
        const prevStage = this.__itemsParam.getElement(event.index - 1).getStage();
        event.elem.setStage(prevStage + 1);
        this.__stagesParam.setValue(prevStage + 2);
      } else {
        this.__stagesParam.setValue(1);
      }
      event.elem.__output = new OperatorOutput('Part' + event.index, OperatorOutputMode.OP_READ_WRITE);
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

Registry.register('ExplodePartsOperator', ExplodePartsOperator);

/** Class representing a gear parameter.
 * @extends StructParameter
 */
class GearParameter extends StructParameter {
  /**
   * Create a gear parameter.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.__ratioParam = this._addMember(new NumberParameter('Ratio', 1.0));
    this.__offsetParam = this._addMember(new NumberParameter('Offset', 0.0));
    this.__axisParam = this._addMember(new Vec3Parameter('Axis', new Vec3(1, 0, 0)));
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
class GearsOperator extends Operator {
  /**
   * Create a gears operator.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.__revolutionsParam = this.addParameter(new NumberParameter('Revolutions', 0.0));
    const rpmParam = this.addParameter(new NumberParameter('RPM', 0.0)); // revolutions per minute
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
    this.__gearsParam = this.addParameter(new ListParameter('Gears', GearParameter));
    this.__gearsParam.on('elementAdded', event => {
      event.elem.__output = new OperatorOutput('Gear' + event.index, OperatorOutputMode.OP_READ_WRITE);
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

      const quat = new Quat();
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

Registry.register('GearsOperator', GearsOperator);

/** Class representing a piston parameter.
 * @extends StructParameter
 */
class PistonParameter extends StructParameter {
  /**
   * Create a piston parameter.
   * @param {string} name - The name value.
   */
  constructor() {
    super('Piston');

    // this.__pistonAxisParam = this._addMember(new Vec('Axis', 0));
    this.__pistonAngleParam = this._addMember(new NumberParameter('PistonAngle', 0));
    this.__camPhaseParam = this._addMember(new NumberParameter('CamPhase', 0));
    this.__camLengthParam = this._addMember(new NumberParameter('CamLength', 3));
    this.__rodLengthParam = this._addMember(new NumberParameter('RodLength', 3));

    // The first RodItem added causes the rodOffset to be computed.
    this.__rodOutput = new OperatorOutput('Rod', OperatorOutputMode.OP_READ_WRITE);
    this.__capOutput = new OperatorOutput('Cap', OperatorOutputMode.OP_READ_WRITE);

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
    const crankVec = new Vec3(
      Math.sin(MathFunctions.degToRad(pistonAngle)),
      Math.cos(MathFunctions.degToRad(pistonAngle)),
      0.0
    );
    this.__pistonAxis = this.__baseCrankXfo.ori.rotateVec3(crankVec);

    this.__camVec = this.__baseCrankXfo.ori.rotateVec3(
      new Vec3(Math.sin(camPhase * 2.0 * Math.PI) * camLength, Math.cos(camPhase * 2.0 * Math.PI) * camLength, 0.0)
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

      const rotRotation = new Quat();
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
class PistonOperator extends Operator {
  /**
   * Create a piston operator.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.__revolutionsParam = this.addParameter(new NumberParameter('Revolutions', 0.0, [0, 1]));
    const rpmParam = this.addParameter(new NumberParameter('RPM', 0.0)); // revolutions per minute
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
    this.__crankOutput = this.addOutput(new OperatorOutput('Crank', OperatorOutputMode.OP_READ_WRITE));
    this.__crankOutput.on('paramSet', this.init.bind(this));
    this.__crankAxisParam = this.addParameter(new Vec3Parameter('CrankAxis', new Vec3(1, 0, 0)));
    this.__crankAxisParam.on('valueChanged', () => {
      // this.__baseCrankXfo.ori.setFromAxisAndAngle(this.__crankAxisParam.getValue(), 0.0);
      this.__baseCrankXfo.ori.setFromDirectionAndUpvector(this.__crankAxisParam.getValue(), new Vec3(0, 0, 1));
      this.init();
    });
    this.__pistonsParam = this.addParameter(new ListParameter('Pistons', PistonParameter));
    this.__pistonsParam.on('elementAdded', event => {
      event.elem.setCrankXfo(this.__baseCrankXfo);

      this.addOutput(event.elem.getRodOutput());
      this.addOutput(event.elem.getCapOutput());
    });
    this.__pistonsParam.on('elementRemoved', event => {
      this.removeOutput(event.elem.getRodOutput());
      this.removeOutput(event.elem.getCapOutput());
    });

    this.__baseCrankXfo = new Xfo();
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
    const quat = new Quat();
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

Registry.register('PistonOperator', PistonOperator);

/** An operator for aiming items at targets.
 * @extends Operator
 */
class AimOperator extends Operator {
  /**
   * Create a gears operator.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.addParameter(new NumberParameter('Weight', 1));
    this.addParameter(
      new MultiChoiceParameter('Axis', 0, ['+X Axis', '-X Axis', '+Y Axis', '-Y Axis', '+Z Axis', '-Z Axis'])
    );

    this.addParameter(new NumberParameter('Stretch', 0.0));
    this.addParameter(new NumberParameter('Initial Dist', 1.0));
    // this.addParameter(new XfoParameter('Target'))
    this.addInput(new OperatorInput('Target'));
    this.addOutput(new OperatorOutput('InputOutput', OperatorOutputMode.OP_READ_WRITE));
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
    let align = new Quat();
    align.setFrom2Vectors(vec, dir);
    align.alignWith(new Quat());
    if (weight < 1.0) align = new Quat().lerp(align, weight);
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

Registry.register('AimOperator', AimOperator);

/** An operator for aiming items at targets.
 * @extends Operator
 */
class RamAndPistonOperator extends Operator {
  /**
   * Create a gears operator.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.addParameter(
      new MultiChoiceParameter('Axis', 0, ['+X Axis', '-X Axis', '+Y Axis', '-Y Axis', '+Z Axis', '-Z Axis'])
    );

    this.addOutput(new OperatorOutput('Ram', OperatorOutputMode.OP_READ_WRITE));
    this.addOutput(new OperatorOutput('Piston', OperatorOutputMode.OP_READ_WRITE));
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

    const alignRam = new Quat();
    const alignPiston = new Quat();
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

Registry.register('RamAndPistonOperator', RamAndPistonOperator);

/** An operator for aiming items at targets.
 * @extends Operator
 */
class TriangleIKSolver extends Operator {
  /**
   * Create a gears operator.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);
    // this.addParameter(
    //   new MultiChoiceParameter('Axis', 0, ['+X Axis', '-X Axis', '+Y Axis', '-Y Axis', '+Z Axis', '-Z Axis'])
    // )
    this.addInput(new OperatorInput('Target'));
    this.addOutput(new OperatorOutput('Joint0', OperatorOutputMode.OP_READ_WRITE));
    this.addOutput(new OperatorOutput('Joint1', OperatorOutputMode.OP_READ_WRITE));
    this.align = new Quat();
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

    joint01Vec.normalizeInPlace();
    joint0TargetVec.normalizeInPlace();

    const Joint0Axis = joint0TargetVec.cross(joint01Vec);
    const currAngle = joint0TargetVec.angleTo(joint01Vec);
    Joint0Axis.normalizeInPlace();

    // Calculate the angle using the rule of cosines.
    // cos C	= (a2 + b2 − c2)/2ab
    const a = this.joint0Length;
    const b = joint0TargetDist;
    const c = this.joint1Length;
    const angle = Math.acos((a * a + b * b - c * c) / (2 * a * b));

    // console.log(currAngle, angle)

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

Registry.register('TriangleIKSolver', TriangleIKSolver);

const X_AXIS = new Vec3(1, 0, 0);
const Y_AXIS = new Vec3(0, 1, 0);
const Z_AXIS = new Vec3(0, 0, 1);
const identityXfo = new Xfo();

class IKJoint {
  constructor(globalXfoParam, axisId = 0) {
    this.axisId = axisId;
    this.limits = [-Math.PI, Math.PI];
    this.align = new Quat();
    // this.output = new OperatorOutput('Joint')
    // this.output.setParam(globalXfoParam)
  }

  init(baseXfo, parentJoint, childJoint) {
    this.xfo = this.output.getValue().clone(); // until we have an IO output
    const parentXfo = parentJoint ? parentJoint.xfo : baseXfo;
    this.bindLocalXfo = parentXfo.inverse().multiply(this.xfo);
    this.localXfo = this.bindLocalXfo.clone();
    if (childJoint) {
      this.backwardsLocal = childJoint.output
        .getValue()
        .inverse()
        .multiply(this.xfo);
    }
    this.forwardLocalTr = this.localXfo.tr;
    this.backwardsLocalTr = this.forwardLocalTr.negate();

    this.tipVec = new Vec3();

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

    const parentVec = this.xfo.tr.subtract(parentXfo.tr).normalize();
    this.isTwistJoint = Math.abs(this.xfo.ori.rotateVec3(this.axis).dot(parentVec) - 1) < 0.001;
    console.log(this.isTwistJoint);

    // const childXfo =
    // this.xfo = this.output.getValue().clone() // until we have an IO output
    // this.bindLocalXfo = (parentJoint ? parentJoint : baseXfo).xfo.inverse().multiply(this.xfo)
  }

  preEval(parentXfo) {
    // this.xfo = this.output.getValue().clone() // until we have an IO output
    // this.xfo.ori = parentXfo.ori.multiply(this.bindLocalXfo.ori)
    // this.xfo.tr = parentXfo.tr.add(parentXfo.ori.rotateVec3(this.bindLocalXfo.tr))
  }

  evalBackwards(parentJoint, childJoint, isTip, targetXfo, baseXfo, jointToTip) {
    if (isTip) {
      this.xfo.tr = targetXfo.tr.clone();
      this.xfo.ori = targetXfo.ori.clone();
    } else {
      const targetVec = childJoint.xfo.tr.subtract(baseXfo.tr);
      const jointVec = this.xfo.ori.rotateVec3(childJoint.forwardLocalTr);
      {
        this.align.setFrom2Vectors(jointToTip.normalize(), targetVec.normalize());
        // this.align.alignWith(this.xfo.ori)
        this.xfo.ori = this.align.multiply(this.xfo.ori);
      }
      jointToTip.subtractInPlace(jointVec);

      ///////////////////////
      // Apply joint constraint.
      this.align.setFrom2Vectors(
        this.xfo.ori.rotateVec3(childJoint.axis),
        childJoint.xfo.ori.rotateVec3(childJoint.axis)
      );
      this.xfo.ori = this.align.multiply(this.xfo.ori);

      ///////////////////////
      // Apply angle Limits.

      // const currAngle = Math.acos(this.xfo.ori.dot(parentXfo.ori))
      // if (currAngle < childJoint.limits[0] || currAngle > childJoint.limits[1]) {
      //   const deltaAngle =
      //     currAngle < childJoint.limits[0] ? childJoint.limits[0] - currAngle : currAngle - childJoint.limits[1]
      //   this.align.setFromAxisAndAngle(globalAxis, deltaAngle)
      //   this.xfo.ori = this.align.multiply(this.xfo.ori)
      // }

      this.xfo.tr = childJoint.xfo.tr.subtract(this.xfo.ori.rotateVec3(childJoint.forwardLocalTr));
    }
  }

  evalForwards(parentJoint, childJoint, isBase, isTip, baseXfo, targetXfo, jointToTip) {
    if (isBase) {
      this.xfo.tr = baseXfo.tr.add(baseXfo.ori.rotateVec3(this.forwardLocalTr));
    } else {
      this.xfo.tr = parentJoint.xfo.tr.add(parentJoint.xfo.ori.rotateVec3(this.forwardLocalTr));
    }
    if (isTip) {
      this.xfo.ori = targetXfo.ori;
    } else {
      if (isBase) {
        jointToTip.subtractInPlace(baseXfo.ori.rotateVec3(this.forwardLocalTr));
      } else {
        jointToTip.subtractInPlace(parentJoint.xfo.ori.rotateVec3(this.forwardLocalTr));
      }
      const jointVec = this.xfo.ori.rotateVec3(childJoint.forwardLocalTr);
      const targetVec = targetXfo.tr.subtract(this.xfo.tr);
      if (this.axisId == -2) {
        if (targetVec.normalize().angleTo(jointVec.normalize()) > 0.0001) {
          const alignAxis = targetVec.cross(jointVec).normalize();
          const childAxis = this.xfo.ori.rotateVec3(childJoint.axis);
          this.align.setFrom2Vectors(childAxis, alignAxis);
          this.xfo.ori = this.align.multiply(this.xfo.ori);
        }
      } else {
        this.align.setFrom2Vectors(jointToTip.normalize(), targetVec.normalize());
        this.xfo.ori = this.align.multiply(this.xfo.ori);
      }
    }

    ///////////////////////
    // Apply joint constraint.
    if (isBase) {
      this.align.setFrom2Vectors(this.xfo.ori.rotateVec3(this.axis), baseXfo.ori.rotateVec3(this.axis));
    } else {
      this.align.setFrom2Vectors(this.xfo.ori.rotateVec3(this.axis), parentJoint.xfo.ori.rotateVec3(this.axis));
    }
    this.xfo.ori = this.align.multiply(this.xfo.ori);
  }

  setClean() {
    this.output.setClean(this.xfo);
  }
}

/** An operator for aiming items at targets.
 * @extends Operator
 */
class IKSolver extends Operator {
  /**
   * Create a gears operator.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.addParameter(new NumberParameter('Iterations', 10));
    // this.addParameter(new NumberParameter('Weight', 1))

    // this.jointsParam = this.addParameter(new ListParameter('Joints', CCDIKJointParameter))
    // this.jointsParam.on('elementAdded', event => {
    //   this.addOutput(event.elem.getOutput(), event.index)
    // })
    // this.jointsParam.on('elementRemoved', event => {
    //   this.removeOutput(event.index)
    // })

    this.addInput(new OperatorInput('Base'));
    this.addInput(new OperatorInput('Target'));
    this.__joints = [];
    this.enabled = false;
  }

  addJoint(globalXfoParam, axisId = 0) {
    // const output = this.addOutput(new OperatorOutput('Joint', OperatorOutputMode.OP_READ_WRITE))
    const joint = new IKJoint(globalXfoParam, axisId);

    const output = this.addOutput(new OperatorOutput('Joint' + this.__joints.length));
    output.setParam(globalXfoParam);
    joint.output = output;

    this.__joints.push(joint);
    return joint
  }

  enable() {
    const baseXfo = this.getInput('Base').isConnected() ? this.getInput('Base').getValue() : identityXfo;
    this.__joints.forEach((joint, index) => {
      const parentJoint = index > 0 ? this.__joints[index - 1] : null;
      const childJoint = index < this.__joints.length ? this.__joints[index + 1] : null;
      joint.init(baseXfo, parentJoint, childJoint);
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
    // const rootJoint = this.__joints[0]
    const baseXfo = this.getInput('Base').isConnected() ? this.getInput('Base').getValue() : identityXfo;

    const numJoints = this.__joints.length;
    const tipJoint = this.__joints[numJoints - 1];

    const iterations = this.getParameter('Iterations').getValue();

    for (let i = 0; i < numJoints; i++) {
      const parentXfo = i > 0 ? this.__joints[i - 1].xfo : baseXfo;
      this.__joints[i].preEval(parentXfo);
    }

    for (let i = 0; i < iterations; i++) {
      {
        const jointToTip = tipJoint.xfo.tr.subtract(baseXfo.tr);
        for (let j = numJoints - 1; j >= 0; j--) {
          const joint = this.__joints[j];
          const parentJoint = this.__joints[Math.max(j - 1, 0)];
          const childJoint = this.__joints[Math.min(j + 1, numJoints - 1)];
          const isTip = j > 0 && j == numJoints - 1;
          joint.evalBackwards(parentJoint, childJoint, isTip, targetXfo, baseXfo, jointToTip);
        }
      }
      {
        const jointToTip = tipJoint.xfo.tr.subtract(baseXfo.tr);
        for (let j = 0; j < numJoints; j++) {
          const joint = this.__joints[j];
          const parentJoint = this.__joints[Math.max(j - 1, 0)];
          const childJoint = this.__joints[Math.min(j + 1, numJoints - 1)];
          const isBase = j == 0;
          const isTip = j > 0 && j == numJoints - 1;
          joint.evalForwards(parentJoint, childJoint, isBase, isTip, baseXfo, targetXfo, jointToTip);
        }
      }
    }

    // Now store the value to the connected Xfo parameter.
    for (let i = 0; i < numJoints; i++) {
      this.__joints[i].setClean();
    }
  }
}

Registry.register('IKSolver', IKSolver);

/** An operator for aiming items at targets.
 * @extends Operator
 */
class AttachmentConstraint extends Operator {
  /**
   * Create a gears operator.
   * @param {string} name - The name value.
   */
  constructor(name) {
    super(name);

    this.addInput(new OperatorInput('Time'));
    this.addOutput(new OperatorOutput('Attached', OperatorOutputMode.OP_READ_WRITE));

    this.__attachTargets = [];
    this.__attachId = -1;
  }

  addAttachTarget(target, time) {
    const input = this.addInput(new OperatorInput('Target' + this.getNumInputs()));
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

Registry.register('AttachmentConstraint', AttachmentConstraint);

/** Class representing a gear parameter.
 * @extends BaseTrack
 */
class BaseTrack extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.keys = [];
    this.__sampleCache = {};
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
    this.emit('keyValueChanged', { index });
  }

  getTimeRange() {
    if (this.keys.length == 0) {
      return new Vec2(Number.NaN, Number.NaN)
    }
    const numKeys = this.keys.length;
    return new Vec2(this.keys[0].time, this.keys[numKeys - 1].time)
  }

  addKey(time, value) {
    let index;
    if (this.keys.length == 0 || time < this.keys[0].time) {
      this.keys.splice(0, 0, { time, value });
      index = 0;
    } else {
      const numKeys = this.keys.length;
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

    this.emit('keyAdded', { index });
    return index
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
      return new Xfo(tr, ori)
    } else {
      return value0
    }
  }
}

/** An operator for aiming items at targets.
 * @extends Operator
 */
class TrackSampler extends Operator {
  /**
   * Create a TrackSampler operator.
   * @param {string} name - The name value.
   */
  constructor(name, track) {
    super(name);

    this.track = track;

    this.addInput(new OperatorInput('Time'));
    this.addOutput(new OperatorOutput('Output', OperatorOutputMode.OP_WRITE));
  }

  /**
   * The evaluate method.
   */
  evaluate() {
    const time = this.getInput('Time').getValue();
    const output = this.getOutputByIndex(0);

    const xfo = this.track.evaluate(time);
    output.setClean(xfo);
  }
}

/** An operator for aiming items at targets.
 * @extends Operator
 */
class KeyDisplayOperator extends Operator {
  /**
   * Create a gears operator.
   * @param {BaseTrack} track - The track value.
   * @param {number} keyIndex - The index of the key in the track
   */
  constructor(track, keyIndex) {
    super(name);

    this.addOutput(new OperatorOutput('KeyLocal', OperatorOutputMode.OP_WRITE));

    this.track = track;
    this.keyIndex = keyIndex;
    this.track.on('keyValueChanged', event => {
      if (event.index == this.keyIndex) this.setDirty();
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
class XfoTrackDisplay extends GeomItem {
  /**
   * Create a TrackDisplay operator.
   * @param {string} name - The name value.
   * @param {BaseTrack} track - The track to display.
   */
  constructor(track) {
    super(track.getName());

    this.track = track;

    this.getParameter('Geometry').setValue(new Lines());

    const linesMat = new Material('trackLine', 'FlatSurfaceShader');
    linesMat.getParameter('BaseColor').setValue(new Color(0.3, 0.3, 0.3));
    this.getParameter('Material').setValue(linesMat);

    const dotsMat = new Material('trackDots', 'PointsShader');
    dotsMat.getParameter('BaseColor').setValue(new Color(0.75, 0.75, 0.75));
    this.dotsItem = new GeomItem('dots', new Points(), dotsMat);
    this.addChild(this.dotsItem);

    try {
      this.__keyMat = new Material('trackLine', 'HandleShader');
      this.__keyMat.getParameter('maintainScreenSize').setValue(1);
      this.__keyCube = new Cuboid(0.004, 0.004, 0.004);
    } catch (error) {
      this.__keyMat = new Material('trackLine', 'SimpleSurfaceShader');
      this.__keyCube = new Cuboid(0.01, 0.01, 0.01);
    }

    this.__keys = [];
    this.__updatePath();
    this.__displayKeys();

    this.track.on('keyValueChanged', event => {
      this.__updatePath();
    });
  }

  __displayKeys() {
    const displayKey = index => {
      const handle = new GeomItem('key' + index, this.__keyCube, this.__keyMat);
      this.addChild(handle);
      const keyDisplay = new KeyDisplayOperator(this.track, index);
      keyDisplay.getOutput('KeyLocal').setParam(handle.getParameter('LocalXfo'));
      this.__keys.push(handle);
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
    const numSamples = Math.round((timeRange.y - timeRange.x) / 50); // Display at 50 samples per second

    trackLines.setNumVertices(numSamples);
    trackLines.setNumSegments(numSamples + 1);

    trackDots.setNumVertices(numSamples);
    const linePositions = trackLines.getVertexAttribute('positions');
    const dotPositions = trackDots.getVertexAttribute('positions');
    for (let i = 0; i < numSamples; i++) {
      trackLines.setSegmentVertexIndices(i, i, i + 1);
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

export { AimOperator, AttachmentConstraint, ColorTrack, ExplodePartsOperator, GearsOperator, IKSolver, PistonOperator, RamAndPistonOperator, TrackSampler, TriangleIKSolver, XfoTrack, XfoTrackDisplay };
