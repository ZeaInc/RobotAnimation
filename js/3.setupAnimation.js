const { Vec3, Xfo, Color, NumberParameter, Material, Cuboid, GeomItem, MathFunctions } = window.zeaEngine
const { XfoTrack, TrackSampler, XfoTrackDisplay, AttachmentConstraint, RemoveKeyChange } = window.zeaKinematics
const { UndoRedoManager } = window.zeaUx

const setupAnimation = (treeItem) => {
  const timeParam = new NumberParameter('time', 0)
  timeParam.setRange([0, 7000])
  treeItem.addParameter(timeParam)

  const xfoTrack = new XfoTrack('XfoTrack')

  ///////////////////////////////////////////////////
  // Setup the time bar

  const timeline = document.getElementById('timeline')
  const timeBar = document.getElementById('timebar')
  const prevKey = document.getElementById('prevkey')
  const nextKey = document.getElementById('nextkey')

  let playingId = false
  const play = () => {
    let time = Math.round(timeParam.getValue())
    const range = timeParam.getRange()
    if (!playingId) {
      playingId = setInterval(() => {
        time += 20
        timeParam.setValue(Math.round(time))
        if (time > range[1]) time = range[0]
      }, 20)
    }
  }
  const stop = () => {
    clearInterval(playingId)
    playingId = null
  }
  const setTime = (time) => {
    timeParam.setValue(Math.round(time))
  }
  const saveTrack = () => {
    const json = xfoTrack.toJSON()
    console.log(JSON.stringify(json, undefined, ' '))
  }

  document.addEventListener('keydown', (event) => {
    const key = String.fromCharCode(event.keyCode).toLowerCase()
    switch (key) {
      case ' ':
        if (playingId) stop()
        else play()
        break
      case 's':
        if (event.ctrlKey) saveTrack()
        break
      case '': {
        const time = Math.round(timeParam.getValue())
        const keyAndLerp = xfoTrack.findKeyAndLerp(time)
        if (keyAndLerp.lerp == 0.0) {
          // xfoTrack.removeKey(keyAndLerp.keyIndex)
          const removeKeyChange = new RemoveKeyChange(xfoTrack, keyAndLerp.keyIndex)
          UndoRedoManager.getInstance().addChange(removeKeyChange)
        }
        break
      }
    }
  })

  timeline.addEventListener('mousedown', (event) => {
    if (playingId) stop()
    dragTimeBar(event)
    document.addEventListener('mousemove', dragTimeBar)
    document.addEventListener('mouseup', endDragTimeBar)
    event.stopPropagation()
    event.preventDefault()
  })

  const dragTimeBar = (event) => {
    const range = timeParam.getRange()
    const time = ((event.clientX - 5) / timeline.offsetWidth) * range[1]
    setTime(time)
    event.stopPropagation()
    event.preventDefault()
  }

  const endDragTimeBar = (event) => {
    document.removeEventListener('mousemove', dragTimeBar)
    document.removeEventListener('mouseup', endDragTimeBar)
  }

  timeParam.on('valueChanged', () => {
    const range = timeParam.getRange()
    const time = MathFunctions.clamp(timeParam.getValue(), range[0], range[1])
    timeBar.style.left = `${(time / range[1]) * timeline.offsetWidth - timeBar.offsetWidth * 0.5}px`
  })

  prevKey.addEventListener('mousedown', () => {
    event.stopPropagation()
    event.preventDefault()
    if (playingId) stop()
    const time = Math.round(timeParam.getValue())
    const keyAndLerp = xfoTrack.findKeyAndLerp(time)
    if (keyAndLerp.lerp > 0.0) {
      const time = xfoTrack.getKeyTime(keyAndLerp.keyIndex)
      timeParam.setValue(time)
    } else if (keyAndLerp.keyIndex > 0) {
      const time = xfoTrack.getKeyTime(keyAndLerp.keyIndex - 1)
      timeParam.setValue(time)
    } else {
      const time = xfoTrack.getKeyTime(xfoTrack.getNumKeys() - 1)
      timeParam.setValue(time)
    }
  })

  nextKey.addEventListener('mousedown', () => {
    event.stopPropagation()
    event.preventDefault()
    if (playingId) stop()
    const time = Math.round(timeParam.getValue())
    const keyAndLerp = xfoTrack.findKeyAndLerp(time)
    if (keyAndLerp.keyIndex < xfoTrack.getNumKeys() - 1) {
      const time = xfoTrack.getKeyTime(keyAndLerp.keyIndex + 1)
      timeParam.setValue(time)
    } else {
      const time = xfoTrack.getKeyTime(0)
      timeParam.setValue(time)
    }
  })

  ///////////////////////////////////////

  const target = treeItem.getChildByName('target')
  const asset = treeItem.getChildByName('MC700_ASSY')

  const makePlate = () => {
    const plateMaterial = new Material('plateMaterial', 'SimpleSurfaceShader')
    plateMaterial.getParameter('BaseColor').setValue(new Color(0, 0, 1))
    const plateItem = new GeomItem('plate', new Cuboid(1.0, 2.0, 0.02), plateMaterial)
    treeItem.addChild(plateItem)
    const xfo = new Xfo()
    xfo.tr.set(2.9, -1.0, 0.5)
    xfo.ori.setFromAxisAndAngle(new Vec3(0, 1, 0), Math.PI * 0.5)
    plateItem.getParameter('GlobalXfo').setValue(xfo)
    return plateItem
  }
  const plateItem = makePlate()

  const makeStamper = () => {
    const stamperMaterial = new Material('stamperMaterial', 'SimpleSurfaceShader')
    stamperMaterial.getParameter('BaseColor').setValue(new Color(0, 1, 1))
    const stamperItem = new GeomItem('stamper', new Cuboid(1.0, 2.0, 0.5, true), stamperMaterial)
    treeItem.addChild(stamperItem)

    const xfo = new Xfo()
    xfo.tr.set(0.0, 2.5, 0.0)
    xfo.ori.setFromAxisAndAngle(new Vec3(0, 0, 1), Math.PI * 0.5)
    stamperItem.getParameter('GlobalXfo').setValue(xfo)
    return stamperItem
  }
  const stamperItem = makeStamper()

  asset.on('loaded', () => {
    const xfoTrackSampler = new TrackSampler('XfoTrack', xfoTrack)
    xfoTrackSampler.getInput('Time').setParam(timeParam)
    xfoTrackSampler.getOutput('Output').setParam(target.getParameter('GlobalXfo'))

    const urlParams = new URLSearchParams(window.location.search)
    if (!urlParams.has('nokeys')) {
      fetch('data/XfoTrack.json')
        .then((response) => response.json())
        .then((json) => {
          xfoTrack.fromJSON(json)
          play()
        })

      /////////////////////////////////////////////////
      // Robot Head

      const robotHead = asset.getChildByName('NAUO15')
      const sttachmentConstraint = new AttachmentConstraint('PlateAttach')
      sttachmentConstraint.getInput('Time').setParam(timeParam)
      sttachmentConstraint.getOutput('Attached').setParam(plateItem.getParameter('GlobalXfo'))
      sttachmentConstraint.addAttachTarget(robotHead.getParameter('GlobalXfo'), 2600)
      sttachmentConstraint.addAttachTarget(stamperItem.getParameter('GlobalXfo'), 5400)

      /////////////////////////////////////////////////
    }

    const TrackDisplay = new XfoTrackDisplay(xfoTrack)
    treeItem.addChild(TrackDisplay)
  })
}

export default setupAnimation
