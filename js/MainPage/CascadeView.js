import * as THREE from 'three';
import { STLExporter, OBJExporter, DragControls, OrbitControls, TransformControls } from 'three/examples/jsm/Addons.js'
// This file governs the 3D Viewport which displays the 3D Model
// It is also in charge of saving to STL and OBJ

/** Create the base class for a 3D Viewport.
 *  This includes the floor, the grid, the fog, the camera, and lights */
export class Environment {
  constructor(goldenContainer) {
    this.goldenContainer = goldenContainer;

    this.initEnvironment = function () {
      // Get the current Width and Height of the Parent Element
      this.parentWidth = this.goldenContainer.width;
      this.parentHeight = this.goldenContainer.height;

      // Create the Canvas and WebGL Renderer
      this.curCanvas = document.createElement('canvas');
      this.goldenContainer.getElement().get(0).appendChild(this.curCanvas);
      this.renderer = new THREE.WebGLRenderer({ canvas: this.curCanvas, antialias: true, webgl2: false });
      this.renderer.setPixelRatio(window.devicePixelRatio); this.renderer.setSize(this.parentWidth, this.parentHeight);
      this.goldenContainer.on('resize', this.onWindowResize.bind(this));

      // Create the Three.js Scene
      this.scene = new THREE.Scene();
      this.backgroundColor = 0x222222; //0xa0a0a0
      this.scene.background = new THREE.Color(this.backgroundColor);
      this.scene.fog = new THREE.Fog(this.backgroundColor, 200, 600);

      this.camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
      //new THREE.OrthographicCamera(300 / - 2, 300 / 2, 300 / 2, 300 / - 2, 1, 1000);
      // Consider an Orthographic Camera.  It doesn't look so hot with the Matcap Material.
      this.camera.position.set(50, 100, 150);
      this.camera.lookAt(0, 45, 0);
      this.camera.aspect = this.parentWidth / this.parentHeight;
      this.camera.updateProjectionMatrix();

      // Create two lights to evenly illuminate the model and cast shadows
      this.light = new THREE.HemisphereLight(0xffffff, 0x444444);
      this.light.position.set(0, 200, 0);
      this.light2 = new THREE.DirectionalLight(0xbbbbbb);
      this.light2.position.set(6, 50, -12);
      this.light2.castShadow = true;
      this.light2.shadow.camera.top = 200;
      this.light2.shadow.camera.bottom = -200;
      this.light2.shadow.camera.left = -200;
      this.light2.shadow.camera.right = 200;
      //this.light2.shadow.radius        =  32;
      this.light2.shadow.mapSize.width = 128;
      this.light2.shadow.mapSize.height = 128;
      this.scene.add(this.light);
      this.scene.add(this.light2);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      //this.scene.add(new THREE.CameraHelper(this.light2.shadow.camera));
      // Set up the orbit controls used for Cascade Studio
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.target.set(0, 45, 0);
      this.controls.panSpeed = 2;
      this.controls.zoomSpeed = 1;
      this.controls.screenSpacePanning = true;
      this.controls.update();

      // Keep track of the last time the scene was interacted with
      // This allows for lazy rendering to reduce power consumption
      this.controls.addEventListener('change', () => this.viewDirty = true);
      this.isVisible = true; this.viewDirty = true;
      this.time = new THREE.Clock();
      this.time.autoStart = true;
      this.lastTimeRendered = 0.0;

      this.goldenContainer.layoutManager.eventHub.emit('Start');
    };

    // Resize the container, canvas, and renderer when the window resizes
    this.onWindowResize = function () {
      this.goldenContainer.layoutManager.updateSize(window.innerWidth, window.innerHeight -
        document.getElementsByClassName('topnav')[0].offsetHeight);
      this.camera.aspect = this.goldenContainer.width / this.goldenContainer.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.goldenContainer.width, this.goldenContainer.height);
      this.renderer.render(this.scene, this.camera);
      this.viewDirty = true;
    };

    // Initialize the Environment!
    this.initEnvironment();
  }
}

/** This "inherits" from Environment (by including it as a sub object) */
export class CascadeEnvironment {
  constructor(goldenContainer, messageHandlers) {
    this.active = true;
    this.goldenContainer = goldenContainer;
    this.environment = new Environment(this.goldenContainer);

    // State for the Hover Highlighting
    this.raycaster = new THREE.Raycaster();
    this.highlightedObj = null;
    this.fogDist = 200;

    // State for the Handles
    this.handles = [];
    this.gizmoMode = "translate";
    this.gizmoSpace = "local";

    // Load the Shiny Dull Metal Matcap Material
    this.loader = new THREE.TextureLoader(); this.loader.setCrossOrigin('');
    this.matcap = this.loader.load('./textures/dullFrontLitMetal.png', (tex) => { this.environment.viewDirty = true; });
    this.matcapMaterial = new THREE.MeshMatcapMaterial({
      color: new THREE.Color(0xf5f5f5),
      matcap: this.matcap,
      polygonOffset: true, // Push the mesh back for line drawing
      polygonOffsetFactor: 2.0,
      polygonOffsetUnits: 1.0
    });

    // A callback to load the Triangulated Shape from the Worker and add it to the Scene
    messageHandlers["combineAndRenderShapes"] = ([[facelist, edgelist], sceneOptions]) => {
      window.workerWorking = false; // Untick this flag to allow Evaluations again
      if (!facelist) { return; } // Do nothing if the results are null


      // The old mainObject is dead!  Long live the mainObject!
      this.environment.scene.remove(this.mainObject);

      this.environment.scene.remove(this.groundMesh);
      if (sceneOptions.groundPlaneVisible) {
        // Create the ground mesh
        this.groundMesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(2000, 2000),
          new THREE.MeshPhongMaterial({
            color: 0x080808, depthWrite: true, dithering: true,
            polygonOffset: true, // Push the mesh back for line drawing
            polygonOffsetFactor: 6.0, polygonOffsetUnits: 1.0
          }));
        this.groundMesh.position.y = -0.1;
        this.groundMesh.rotation.x = -Math.PI / 2;
        this.groundMesh.receiveShadow = true;
        this.environment.scene.add(this.groundMesh);
      }

      this.environment.scene.remove(this.grid);
      if (sceneOptions.gridVisible) {
        // Create the Ground Grid; one line every 100 units
        this.grid = new THREE.GridHelper(2000, 20, 0xcccccc, 0xcccccc);
        this.grid.position.y = -0.01;
        this.grid.material.opacity = 0.3;
        this.grid.material.transparent = true;
        this.environment.scene.add(this.grid);
      }

      this.mainObject = new THREE.Group();
      this.mainObject.name = "shape";
      this.mainObject.rotation.x = -Math.PI / 2;

      // Add Triangulated Faces to Object
      let vertices = [], normals = [], triangles = [], uvs = [], colors = []; let vInd = 0; let globalFaceIndex = 0;
      facelist.forEach((face) => {
        // Copy Vertices into three.js Vector3 List
        vertices.push(...face.vertex_coord);
        normals.push(...face.normal_coord);
        uvs.push(...face.uv_coord);

        // Sort Triangles into a three.js Face List
        for (let i = 0; i < face.tri_indexes.length; i += 3) {
          triangles.push(
            face.tri_indexes[i + 0] + vInd,
            face.tri_indexes[i + 1] + vInd,
            face.tri_indexes[i + 2] + vInd);
        }

        // Use Vertex Color to label this face's indices for raycast picking
        for (let i = 0; i < face.vertex_coord.length; i += 3) {
          colors.push(face.face_index, globalFaceIndex, 0);
        }

        globalFaceIndex++;
        vInd += face.vertex_coord.length / 3;
      });

      // Compile the connected vertices and faces into a model
      // And add to the scene
      let geometry = new THREE.BufferGeometry();
      geometry.setIndex(triangles);
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();
      let model = new THREE.Mesh(geometry, this.matcapMaterial);
      model.castShadow = true;
      model.name = "Model Faces";
      this.mainObject.add(model);
      //End Adding Triangulated Faces
      // Add Highlightable Edges to Object
      // This wild complexity is what allows all of the lines to be drawn in a single draw call
      // AND highlighted on a per-edge basis by the mouse hover.  On the docket for refactoring.
      let lineVertices = []; let globalEdgeIndices = [];
      let curGlobalEdgeIndex = 0; let edgeVertices = 0;
      let globalEdgeMetadata = {}; globalEdgeMetadata[-1] = { start: -1, end: -1 };
      edgelist.forEach((edge) => {
        let edgeMetadata = {};
        edgeMetadata.localEdgeIndex = edge.edge_index;
        edgeMetadata.start = globalEdgeIndices.length;
        for (let i = 0; i < edge.vertex_coord.length - 3; i += 3) {
          lineVertices.push(new THREE.Vector3(edge.vertex_coord[i],
            edge.vertex_coord[i + 1],
            edge.vertex_coord[i + 2]));

          lineVertices.push(new THREE.Vector3(edge.vertex_coord[i + 3],
            edge.vertex_coord[i + 1 + 3],
            edge.vertex_coord[i + 2 + 3]));
          globalEdgeIndices.push(curGlobalEdgeIndex); globalEdgeIndices.push(curGlobalEdgeIndex);
          edgeVertices++;
        }
        edgeMetadata.end = globalEdgeIndices.length - 1;
        globalEdgeMetadata[curGlobalEdgeIndex] = edgeMetadata;
        curGlobalEdgeIndex++;
      });

      let lineGeometry = new THREE.BufferGeometry().setFromPoints(lineVertices);
      let lineColors = []; for (let i = 0; i < lineVertices.length; i++) { lineColors.push(0, 0, 0); }
      lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
      let lineMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff, linewidth: 1.5, vertexColors: true
      });
      let line = new THREE.LineSegments(lineGeometry, lineMaterial);
      line.globalEdgeIndices = globalEdgeIndices;
      line.name = "Model Edges";
      line.lineColors = lineColors;
      line.globalEdgeMetadata = globalEdgeMetadata;
      line.highlightEdgeAtLineIndex = function (lineIndex) {
        let edgeIndex = lineIndex >= 0 ? this.globalEdgeIndices[lineIndex] : lineIndex;
        let startIndex = this.globalEdgeMetadata[edgeIndex].start;
        let endIndex = this.globalEdgeMetadata[edgeIndex].end;
        for (let i = 0; i < this.lineColors.length; i++) {
          let colIndex = Math.floor(i / 3);
          this.lineColors[i] = (colIndex >= startIndex && colIndex <= endIndex) ? 1 : 0;
        }
        this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.lineColors, 3));
        this.geometry.colorsNeedUpdate = true;
      }.bind(line);
      line.getEdgeMetadataAtLineIndex = function (lineIndex) {
        return this.globalEdgeMetadata[this.globalEdgeIndices[lineIndex]];
      }.bind(line);
      line.clearHighlights = function () {
        return this.highlightEdgeAtLineIndex(-1);
      }.bind(line);
      this.mainObject.add(line);
      // End Adding Highlightable Edges
      // Expand fog distance to enclose the current object; always expand
      //  otherwise you can lose the object if it gets smaller again)
      this.boundingBox = new THREE.Box3().setFromObject(this.mainObject);
      this.fogDist = Math.max(this.fogDist, this.boundingBox.min.distanceTo(this.boundingBox.max) * 1.5);
      this.environment.scene.fog = new THREE.Fog(this.environment.backgroundColor, this.fogDist, this.fogDist + 400);

      this.environment.scene.add(this.mainObject);
      this.environment.viewDirty = true;
      console.log("Generation Complete!");
    };

    /** Save the current shape to .stl */
    this.saveShapeSTEP = () => {
      // Ask the worker thread for a STEP file of the current space
      cascadeStudioWorker.postMessage({ "type": "saveShapeSTEP" });

      // Receive the STEP file content from the Worker Thread
      messageHandlers["saveShapeSTEP"] = async (stepContent) => {
        if (window.showSaveFilePicker) {
          const fileHandle = await getNewFileHandle("STEP files", "text/plain", "step");
          writeFile(fileHandle, stepContent).then(() => {
            console.log("Saved STEP to " + fileHandle.name);
          });
        } else {
          await downloadFile(stepContent, "Untitled", "model/step", "step");
        }
      };
    };

    /**  Save the current shape to an ASCII .stl */
    this.saveShapeSTL = async () => {
      this.stlExporter = new THREE.STLExporter();
      let result = this.stlExporter.parse(this.mainObject);
      if (window.showSaveFilePicker) {
        const fileHandle = await getNewFileHandle("STL files", "text/plain", "stl");
        writeFile(fileHandle, result).then(() => {
          console.log("Saved STL to " + fileHandle.name);
        });
      } else {
        await downloadFile(result, "Untitled", "model/stl", "stl");
      }
    };

    /**  Save the current shape to .obj */
    this.saveShapeOBJ = async () => {
      this.objExporter = new THREE.OBJExporter();
      let result = this.objExporter.parse(this.mainObject);
      if (window.showSaveFilePicker) {
        const fileHandle = await getNewFileHandle("OBJ files", "text/plain", "obj");
        writeFile(fileHandle, result).then(() => {
          console.log("Saved OBJ to " + fileHandle.name);
        });
      } else {
        await downloadFile(result, "Untitled", "model/obj", "obj");
      }
    };

    /** Set up the the Mouse Move Callback */
    this.mouse = { x: 0, y: 0 };
    this.goldenContainer.getElement().get(0).addEventListener('mousemove', (event) => {
      this.mouse.x = (event.offsetX / this.goldenContainer.width) * 2 - 1;
      this.mouse.y = -(event.offsetY / this.goldenContainer.height) * 2 + 1;
    }, false);

    this.animate = function animatethis() {
      // Don't continue this callback if the View has been destroyed.
      if (!this.active) { return; }

      requestAnimationFrame(() => this.animate());

      // Lightly Highlight the faces of the object and the current face/edge index
      // This wild complexity is largely to handle the fact that all the faces and lines
      // are being drawn in a single drawcall.  This is also on the docket for refactoring.
      if (this.mainObject) {
        this.raycaster.setFromCamera(this.mouse, this.environment.camera);
        let intersects = this.raycaster.intersectObjects(this.mainObject.children);
        if (this.environment.controls.state < 0 && intersects.length > 0) {
          let isLine = intersects[0].object.type === "LineSegments";
          let newIndex = isLine ? intersects[0].object.getEdgeMetadataAtLineIndex(intersects[0].index).localEdgeIndex :
            intersects[0].object.geometry.attributes.color.getX(intersects[0].face.a);
          if (this.highlightedObj != intersects[0].object || this.highlightedIndex !== newIndex) {
            if (this.highlightedObj) {
              this.highlightedObj.material.color.setHex(this.highlightedObj.currentHex);
              if (this.highlightedObj && this.highlightedObj.clearHighlights) { this.highlightedObj.clearHighlights(); }
            }
            this.highlightedObj = intersects[0].object;
            this.highlightedObj.currentHex = this.highlightedObj.material.color.getHex();
            this.highlightedObj.material.color.setHex(0xffffff);
            this.highlightedIndex = newIndex;
            if (isLine) { this.highlightedObj.highlightEdgeAtLineIndex(intersects[0].index); }
            this.environment.viewDirty = true;
          }

          let indexHelper = (isLine ? "Edge" : "Face") + " Index: " + this.highlightedIndex;
          this.goldenContainer.getElement().get(0).title = indexHelper;
        } else {
          if (this.highlightedObj) {
            this.highlightedObj.material.color.setHex(this.highlightedObj.currentHex);
            if (this.highlightedObj.clearHighlights) { this.highlightedObj.clearHighlights(); }
            this.environment.viewDirty = true;
          }

          this.highlightedObj = null;
          this.goldenContainer.getElement().get(0).title = "";
        }
      }

      if (this.handles && this.handles.length > 0) {
        for (let i = 0; i < this.handles.length; i++) {
          this.environment.viewDirty = this.handles[i].dragging || this.environment.viewDirty;
        }
      }

      // Only render the Three.js Viewport if the View is Dirty
      // This saves on rendering time/cost now, but may 
      // create headaches in the future.
      if (this.environment.viewDirty) {
        this.environment.renderer.render(this.environment.scene, this.environment.camera);
        this.environment.viewDirty = false;
      }
    };

    // Patch in the Handle Gizmo Code
    initializeHandleGizmos(this);

    this.animate();
    // Initialize the view in-case we're lazy rendering...
    this.environment.renderer.render(this.environment.scene, this.environment.camera);
  }
}

/** Adds Handle Gizmo Functionality to the Cascade View */
function initializeHandleGizmos(threejsViewport){
  /** Create a Transformation Gizmo in the Scene View */
  messageHandlers["createTransformHandle"] = function (payload) {
    if (payload.lineAndColumn[0] <= 0) {
      console.error("Transform Gizmo not supported in this browser!  Use Chrome or Firefox!"); return null;
    }
    let handle = new TransformControls(this.environment.camera,
      this.environment.renderer.domElement);
    handle.setTranslationSnap(1);
    handle.setRotationSnap(THREE.MathUtils.degToRad(1));
    handle.setScaleSnap(0.05);
    handle.setMode(this.gizmoMode);
    handle.setSpace(this.gizmoSpace);
    handle.lineAndColumn = payload.lineAndColumn;
    handle.onChanged = (event) => {
      this.environment.controls.enabled = !event.value;
      this.environment.viewDirty = true;

      // Inject transform data back into the editor upon completion
      if (this.environment.controls.enabled) {
        let code = monacoEditor.getValue().split("\n");
        let lineNum = handle.lineAndColumn[0] - 1;

        let translateString = "[" +
          handle.placeHolder.position.x.toFixed() + ", " +
          -handle.placeHolder.position.z.toFixed() + ", " +
          handle.placeHolder.position.y.toFixed() + "]";
        let axisAngle = [[0, 0, 0], 0];
        let q = handle.placeHolder.quaternion;
        if ((1 - (q.w * q.w)) > 0.001) {
          axisAngle = [[
            q.x / Math.sqrt(1 - q.w * q.w),
            -q.z / Math.sqrt(1 - q.w * q.w),
            q.y / Math.sqrt(1 - q.w * q.w),
          ], 2 * Math.acos(q.w) * 57.2958];
        }
        let rotateString = "[[" +
          axisAngle[0][0].toFixed(2) + ", " +
          axisAngle[0][1].toFixed(2) + ", " +
          axisAngle[0][2].toFixed(2) + "], " +
          axisAngle[1].toFixed(2) + "]";
        let scaleString = handle.placeHolder.scale.x.toFixed(2); // Use this properly later
        let updateString = "Transform(" + translateString + ", " + rotateString + ", " + scaleString + ",";

        let fullSwapped = code[lineNum]
          .replace(/(Transform\(\[(.*?)\]\,\s*\[\[(.*?)\,(.*?)\,(.*?)\]\,(.*?)]\, (.*?)\,)/, updateString);
        if (!code[lineNum].includes(updateString)) { // Only update if the transform has changed!
          if (fullSwapped === code[lineNum]) {
            code[lineNum] = code[lineNum]
              .replace(/(Transform\()/g, updateString + " "); // Initialize all the arguments
          } else {
            code[lineNum] = fullSwapped;
          }

          let newCode = "";
          code.forEach((codeLine) => { newCode += codeLine + "\n"; });
          monacoEditor.setValue(newCode.slice(0, -1));
          monacoEditor.evaluateCode(false);
        }
      }
    };
    handle.addEventListener('dragging-changed', handle.onChanged);

    // Create a fake object for the handle to attach to
    let emptyObject = new THREE.Group();
    emptyObject.position.set(payload.translation[0], payload.translation[2], -payload.translation[1]);
    emptyObject.setRotationFromAxisAngle(
      new THREE.Vector3(payload.rotation[0][0], payload.rotation[0][2], -payload.rotation[0][1]), payload.rotation[1] * 0.0174533);
    emptyObject.scale.set(payload.scale, payload.scale, payload.scale);
    this.environment.scene.add(emptyObject);
    handle.placeHolder = emptyObject;
    handle.attach(emptyObject);

    this.handles.push(handle);
    this.environment.scene.add(handle);
    //return handle;
  }.bind(threejsViewport);

  /** Clear the Transformation Gizmos in the Scene. */
  threejsViewport.clearTransformHandles = function () {
    this.handles.forEach((handle) => {
      handle.removeEventListener('dragging-changed', handle.onChanged);
      this.environment.scene.remove(handle.placeHolder);
      this.environment.scene.remove(handle);
    });
    this.handles = [];
  }.bind(threejsViewport);

  /** Change the Mode that the Transformation Gizmos are in. */
  window.addEventListener('keydown', function (event) {
    switch (event.keyCode) {
      // These match Unity's Hotkeys but I'm open to changing them
      case 88: // X
        this.gizmoSpace = (this.gizmoSpace === "local") ? "world" : "local";
        this.handles.forEach((handle) => { handle.setSpace(this.gizmoSpace); });
        break;
      case 87: // W
        this.gizmoMode = "translate";
        this.handles.forEach((handle) => {
          //handle.showX = true; handle.showY = true; handle.showZ = true;
          handle.setMode(this.gizmoMode);
        });
        break;
      case 69: // E
        this.gizmoMode = "rotate";
        this.handles.forEach((handle) => {
          //handle.showX = true; handle.showY = true; handle.showZ = true;
          handle.setMode(this.gizmoMode);
        });
        break;
      case 82: // R
        this.gizmoMode = "scale";
        this.handles.forEach((handle) => {
          //handle.showX = false; handle.showY = false; handle.showZ = false;
          handle.setMode(this.gizmoMode);
        });
        break;
    }
    this.environment.viewDirty = true;
  }.bind(threejsViewport));
}