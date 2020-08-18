import {
  Quat,
  Color,
  Group,
  Material,
  TreeItem,
  GeomItem,
  Cuboid,
  PassType,
} from '../libs/zea-engine/dist/index.esm.js'
import { GLCADPass, CADAsset } from '../libs/zea-cad/dist/index.rawimport.js'
import { IKSolver, TriangleIKSolver, RamAndPistonOperator } from '../libs/zea-kinematics/dist/index.rawimport.js'

const loadModel = (appData) => {
  const cadPass = new GLCADPass(true)
  cadPass.setShaderPreprocessorValue('#define ENABLE_PBR')
  appData.renderer.addPass(cadPass, PassType.OPAQUE)

  const treeItem = new TreeItem('tree')

  ////////////////////////////////////
  // // Load the Robot Model
  const asset = new CADAsset('MC700_ASSY')
  asset.getParameter('DataFilePath').setUrl('data/MC700_ASSY.zcad')

  treeItem.addChild(asset)

  ////////////////////////////////////
  // Load the Kinematics

  // ///////////////////////////////////////
  // Setup the Solver
  const ikSolver = new IKSolver('ikSolver')
  ikSolver.getParameter('Iterations').setValue(40)
  treeItem.addChild(ikSolver)

  const targGeom = new Cuboid(0.05, 0.1, 0.1)
  const targGeomMaterial = new Material('targGeomMaterial', 'SimpleSurfaceShader')
  targGeomMaterial.getParameter('BaseColor').setValue(new Color(0, 0.5, 0))
  const targGeomItem = new GeomItem('target', targGeom, targGeomMaterial)
  treeItem.addChild(targGeomItem)
  ikSolver.getInput('Target').setParam(targGeomItem.getParameter('GlobalXfo'))

  ///////////////////////////////////////
  // Setup the joints

  const jointMaterial = new Material('Joint0', 'SimpleSurfaceShader')
  jointMaterial.getParameter('BaseColor').setValue(new Color(1, 0, 0))

  function addJoint(name, axis) {
    // const joint = asset.getChildByName(name);
    const joint = new Group(name)
    joint.getParameter('Material').setValue(jointMaterial)
    treeItem.addChild(joint)
    joint.addItem(asset.getChildByName(name))
    ikSolver.addJoint(joint.getParameter('GlobalXfo'), axis)
    return joint
  }

  function addRamAndPiston(ramName, ramParentGroup, pistonName, pistonParentGroup, axis) {
    const ramGroup = new Group(ramName)
    ramGroup.addItem(asset.getChildByName(ramName))
    treeItem.getChildByName(ramParentGroup).addChild(ramGroup)

    const pistonGroup = new Group(pistonName)
    pistonGroup.addItem(asset.getChildByName(pistonName))
    if (typeof pistonParentGroup == 'string') {
      treeItem.getChildByName(pistonParentGroup).addChild(pistonGroup)
    } else pistonParentGroup.addChild(pistonGroup)

    const ramPistonOp = new RamAndPistonOperator(ramName + '>' + pistonName)
    ramPistonOp.getParameter('Axis').setValue(axis)
    ramPistonOp.getOutput('Ram').setParam(ramGroup.getParameter('GlobalXfo'))
    ramPistonOp.getOutput('Piston').setParam(pistonGroup.getParameter('GlobalXfo'))
    treeItem.addChild(ramPistonOp)
    return ramPistonOp
  }

  asset.on('loaded', () => {
    const materialLibrary = asset.getMaterialLibrary()

    // const joint = new Group(name);
    // ikSolver.getInput("Target").setParam(targGeomItem.getParameter("GlobalXfo"));

    addJoint('NAUO1', 2)
    addJoint('NAUO6', 1)
    addJoint('NAUO16', 1)
    addJoint('NAUO7', 0)
    addJoint('NAUO17', 1)
    addJoint('NAUO15', 0)

    /////////////////////////////////////////
    // Setup the Target

    const targXfo = asset.getChildByName('NAUO15').getParameter('GlobalXfo').getValue().clone()
    targXfo.sc.set(1, 1, 1)
    // targXfo.tr = targXfo.ori.rotateVec3(new Vec3(1, 1, 1))
    // targXfo.ori.setFromAxisAndAngle(new Vec3(0, 1, 0), Math.PI * 0.5);
    const align = new Quat()
    // align.setFromAxisAndAngle(new Vec3(0, 1, 0), -0.5)
    // targXfo.ori = align.multiply(targXfo.ori)
    // align.setFromAxisAndAngle(new Vec3(0, 0, 1), 0.5)
    // targXfo.ori = align.multiply(targXfo.ori)
    // console.log(targXfo.ori.rotateVec3(new Vec3(1, 0, 0)).toString())
    targGeomItem.getParameter('GlobalXfo').setValue(targXfo)

    ikSolver.enable()

    /////////////////////////////////////////
    // Setup Counterweight
    const counterweightGroup = new Group('NAUO4')
    counterweightGroup.addItem(asset.getChildByName('NAUO4'))
    treeItem.getChildByName('NAUO1').addChild(counterweightGroup)

    const counterweightRodGroup = new Group('NAUO5')
    counterweightRodGroup.addItem(asset.getChildByName('NAUO5'))
    treeItem.getChildByName('NAUO1').addChild(counterweightRodGroup)

    const counterweightOp = new TriangleIKSolver('Counterweight')
    const targetGeomItem = asset.resolvePath(['NAUO16', 'NAUO67', 'NAUO112'])
    counterweightOp.getInput('Target').setParam(targetGeomItem.getParameter('GlobalXfo'))
    counterweightOp.getOutput('Joint0').setParam(counterweightGroup.getParameter('GlobalXfo'))
    counterweightOp.getOutput('Joint1').setParam(counterweightRodGroup.getParameter('GlobalXfo'))
    counterweightOp.enable()
    treeItem.addChild(counterweightOp)

    /////////////////////////////////////////
    // Setup pistons
    addRamAndPiston('NAUO10', 'NAUO1', 'NAUO11', 'NAUO6', 1)
    addRamAndPiston('NAUO8', 'NAUO1', 'NAUO9', 'NAUO6', 1)

    addRamAndPiston('NAUO12', 'NAUO1', 'NAUO13', 'NAUO6', 4)

    // Counterweight piston
    addRamAndPiston('NAUO3', 'NAUO1', 'NAUO2', counterweightGroup, 4)
  })

  return treeItem
}

export default loadModel
