"use strict";

var test = 0;

//ALIAS UTILI
var Vector3 = glMatrix.vec3;
var Vector4 = glMatrix.vec4;
var Matrix4 = glMatrix.mat4;
var Matrix3 = glMatrix.mat3;

//CORE VARIABLES
var canvas;
var context;
var imageBuffer;
var aspect;
var height;
var width;

var DEBUG = false; //whether to show debug messages
var EPSILON = 0.00001; //error margins
var T_MINIMO = 0.1;
var T_MASSIMO = 10000;

//scene to render
var backgroundcolor = [0,0,0];
var camera;
var surfaces = [];
var lights = [];

var shadow_bias;
var bounce_depth;

//etc...

//CLASSES PROTOTYPES
class Camera {
  constructor(eye,up,at,fovy) {
    this.eye = Vector3.fromValues(eye[0],eye[1],eye[2]); // Posizione della camera    (e)
    this.up = Vector3.fromValues(up[0],up[1],up[2]);     // Inclinazione testa        (t)
    this.at = Vector3.fromValues(at[0],at[1],at[2]);     // Punto verso cui guardo    (?) 
    var dir = Vector3.subtract([], this.at, this.eye);   // Direzione dello sguardo   (g)

    // Ricavo il camera frame {u,v,w} dai vettori eye,at,up (lezione 8, slide 19)
    // Il camera frame è necessario per usare le formule nel calcolo delle intersezioni
    this.w = Vector3.scale([], Vector3.normalize([], dir), -1);           //- normalize(dir);
    this.u = Vector3.normalize([], Vector3.cross([], this.up, this.w));   //normalize(up * w)
    this.v = Vector3.cross([], this.w, this.u);                           //w * u;

    // console.log(this.w, this.u, this.v);
    this.fovy = fovy;
  }

  castRay(u, v) { //calcola il raggio che parte dalla camera e interseca il punto (x,y) nel rettangolo di vista
    //Calcolo la direzione del raggio.
    var dir = Vector3.create();
    var d = 1; //per ipotesi dalle specifiche
    dir[0] = - d * this.w[0] + u * this.u[0] + v * this.v[0];
    dir[1] = - d * this.w[1] + u * this.u[1] + v * this.v[1];
    dir[2] = - d * this.w[2] + u * this.u[2] + v * this.v[2];

    var r = new Ray(this.eye, dir, T_MASSIMO);
    if (DEBUG) console.log("dir:"+dir);
    return r;
    
  }
}

//Surfaces
class Surface { // così modifichiamo uno shade unico per tutto
  constructor(material, transforms, ID) {
    this.ID = ID; //per debug
    this.material = material;
    
    this.M = Matrix4.create();
    var M_translate = Matrix4.create();
    var M_rotate = Matrix4.create();
    var M_scaling = Matrix4.create();
    var M_transformation = Matrix4.create();
    for (var i = (transforms.length)-1; i >= 0; i--) {
      switch (transforms[i][0]) {

        case "Translate":
          M_translate = Matrix4.fromTranslation([], transforms[i][1]);
          M_transformation = M_translate;
          // if (test < 1) {console.log("Mtransl: ", this.M); test++;}
        break;

        case "Rotate":
          M_rotate = Matrix4.fromZRotation([], rad(transforms[i][1][2]));
          M_rotate = Matrix4.multiply([], M_rotate, Matrix4.fromYRotation([], rad(transforms[i][1][1])));
          M_rotate = Matrix4.multiply([], M_rotate, Matrix4.fromXRotation([], rad(transforms[i][1][0])));
          M_transformation = M_rotate;
          // if (test < 1) {console.log( rad(transforms[i][1][0]), rad(transforms[i][1][1]), rad(transforms[i][1][2]) ); test++;}
        break;

        case "Scale":
          M_scaling = Matrix4.fromScaling([], transforms[i][1]);
          M_transformation = M_scaling;
          // if (test < 1) {console.log("Mscala: ", this.M); test++;}
        break;
      }
      this.M = Matrix4.multiply([], M_transformation, this.M);
    }

    this.M_inv = Matrix4.invert([], this.M);
    this.M_norm = Matrix4.transpose([], this.M_inv);
  }

  transformPoint(point) {
    var temp = Vector4.fromValues(point[0], point[1], point[2], 1);
    temp = Matrix4.multiply([], this.M, temp);
    
    return Vector3.fromValues(temp[0], temp[1], temp[2]);
  }

  transformNormal(normal) {
    var temp = Vector4.fromValues(normal[0], normal[1], normal[2], 0);
    temp = Matrix4.multiply([], this.M_norm, temp);
    
    return Vector3.fromValues(temp[0], temp[1], temp[2]);
  }


  shade(ray, point, n, bounce) {
    var color = Vector3.create();
    var k = 0;
    var isReflective = this.material.hasOwnProperty("kr") && (this.material.kr[0]+this.material.kr[1]+this.material.kr[2]) > 0;

    //Calcolo il vettore vista
    var v = Vector3.subtract([], camera.eye, point); //v -> camera direction (view)
    v = Vector3.normalize([], v);

    //Calcolo illuminazione
    for (var i = 0; i < lights.length; i++) {
      var light = lights[i];
      
      var ambient = Vector3.create();
      var diffuse = Vector3.create();
      var specular = Vector3.create();
      var reflex = Vector3.create();

      if (light.source() == "Ambient") {
        ambient = Vector3.multiply([], this.material.ka, light.color);
        Vector3.add(color, color, ambient);
      }
      else { 
        //Luci Direzionali e Puntiformi 
        //le luci ambientali non influenzano comp. diffusa e speculare

        //Ombre
        var l = Vector3.normalize([], Vector3.scale([],light.getDirection(point), -1)); //prende la direzione giusta a seconda del tipo di luce
        var biaspoint = Vector3.scale([],n,shadow_bias); //aggiunge il bias in direzione della normale per evitare di peggiorare l'errore
        biaspoint = Vector3.add([],point,biaspoint); 

        //calcola il vettore riflesso r rispetto alla luce
        var lDotn = Vector3.dot(l, n); //coseno dell'angolo tra normale e raggio di luce!
        var r_l = Vector3.create();
        r_l[0] = 2 * lDotn * n[0] - l[0];
        r_l[1] = 2 * lDotn * n[1] - l[1];
        r_l[2] = 2 * lDotn * n[2] - l[2];
        r_l = Vector3.normalize([], r_l);

        // r rispetto alla direzione del raggio
        var dDotn = Vector3.dot(ray.getDirection(), n);
        var norm_dir = Vector3.normalize([], ray.getDirection());
        var r_d = Vector3.create();
        r_d[0] = norm_dir[0] - 2 * (dDotn) * n[0];
        r_d[1] = norm_dir[1] - 2 * (dDotn) * n[1];
        r_d[2] = norm_dir[2] - 2 * (dDotn) * n[2];
        r_d = Vector3.normalize([], r_d);

        // intersezioni per ombra
        var shadowRay = new Ray(biaspoint,l, Vector3.distance(biaspoint, l)); 
        var ts = false;
        if (DEBUG) console.warn("CALCOLO OMBRE");
        for(var k = 0; ts == false && k < surfaces.length; k++) {
          //if (k != this.ID) {
            var shadowRay_trans = surfaces[k].transformRay(shadowRay);
            ts = surfaces[k].intersects(shadowRay_trans);
            
            if (DEBUG) console.log(this.ID, k, ts);
          //}
        }

        if (ts == false) { //se l'oggetto non è in ombra, calcola illuminazione completa
          
        
          //* Componente Diffusa
          var nDotL = Vector3.dot(n, l);
          nDotL = Math.max(nDotL, 0.0);
          
          diffuse[0] = this.material.kd[0] * light.color[0] * nDotL;
          diffuse[1] = this.material.kd[1] * light.color[1] * nDotL;
          diffuse[2] = this.material.kd[2] * light.color[2] * nDotL;

          Vector3.add(color, color, diffuse);
        
          
          //* Componente Speculare (metodo Phong per Ray-Tracing, Lezione 24, slide 34)
          //calcola intensità lobo di luce
          if (bounce == 0)
            var vDotr = Math.max(Vector3.dot(v, r_l), 0.0);
          else
            var vDotr = Math.max(Vector3.dot(Vector3.scale([], ray.getDirection(), -1), r_l), 0.0);
          var shine = Math.max(Math.pow(vDotr, this.material.shininess), 0.0);
          
          //calcola riflesso
          specular[0] = light.color[0] * this.material.ks[0] * shine;
          specular[1] = light.color[1] * this.material.ks[1] * shine;
          specular[2] = light.color[2] * this.material.ks[2] * shine;
        
          Vector3.add(color, color, specular);
        }

        //* Componente Riflessione a Specchio
        if (bounce < bounce_depth && isReflective) {
          bounce++;

          var reflex_ray = new Ray(point, r_d, T_MASSIMO);
          
          var reflex_color = hit(reflex_ray, bounce);
          reflex[0] = this.material.kr[0] * reflex_color[0];
          reflex[1] = this.material.kr[1] * reflex_color[1];
          reflex[2] = this.material.kr[2] * reflex_color[2];

          Vector3.add(color, color, reflex);
          
          if (DEBUG) {console.log(bounce_depth); test++;}
        }

      }
    }
    return color;
  }

  transformRay(ray) {
     //Allineo il raggio al SdR trasformato
     var temp;

     temp = Vector4.fromValues(ray.a[0],ray.a[1],ray.a[2],1);
     temp = Matrix4.multiply([], this.M_inv, temp);
     var ray_e = Vector3.fromValues(temp[0], temp[1], temp[2]); //origine trasformata

     temp = Vector4.fromValues(ray.dir[0],ray.dir[1],ray.dir[2],0);
     temp = Matrix4.multiply([], this.M_inv, temp);
     var ray_d = Vector3.fromValues(temp[0], temp[1], temp[2]); //direzione trasformata
 
     return new Ray(ray_e, ray_d, ray.tmax);
  }

}

class Sphere extends Surface {
  constructor(center, radius, material, transforms, k) {
    super(material, transforms, k);
    this.center = center;
    this.radius = radius;
  }

  intersects(ray) {
    var ray_e = ray.getOrigin();
    var ray_d = ray.getDirection();

    if (DEBUG) console.warn("SFERA"+this.ID);

    //Metodo analitico (Lezione 24, slide 14)
    var p = Vector3.subtract([], ray_e, this.center); //e - c
    var d = ray_d;
    
    var ddotp = Vector3.dot(d,p);
    var psquare = Vector3.dot(p, p);
    var dsquare = Vector3.dot(d, d);
    
    var delta = ddotp*ddotp - dsquare*(psquare - this.radius*this.radius);
    if (DEBUG) console.log("delta: "+delta);

    
    if (delta >= 0) {
      var t1 = (-ddotp - Math.sqrt(delta)) / dsquare; //più vicino se t1 && t2 > 0
      var t2 = (-ddotp + Math.sqrt(delta)) / dsquare; 

      //Validazione tmin tmax
      if (t1 < T_MINIMO || t1 > ray.tmax) t1 = false; //nota: per js false == 0
      if (t2 < T_MINIMO || t2 > ray.tmax) t2 = false;

      if (DEBUG) console.log("t1: "+t1+"t2: "+t2);

      //Quale dei due usiamo??
      if (t1 > EPSILON) return t1;
      if (t2 > EPSILON) return t2; //la camera è dentro la sfera!
      else return false //sfera dietro alla camera: non la disegno
    } 
    else return false;
  }
  
  getNormal(point) {
    var n = Vector3.create();
    n = Vector3.subtract([], point, this.center);
    n = Vector3.normalize([], n);
    return n;
  }
  
}

class Triangle extends Surface {
  constructor(p1, p2, p3, material, transforms, k) {
    super(material, transforms, k);

    this.a = p1;
    this.b = p2;
    this.c = p3;

    //Normale
    var a_b = Vector3.subtract([], this.a, this.b);
    var b_a = Vector3.subtract([], this.b, this.a);
    var a_c = Vector3.subtract([], this.a, this.c);
    var normal_1 = Vector3.normalize([], Vector3.cross([], a_c, a_b));
    var normal_2 = Vector3.normalize([], Vector3.cross([], a_c, b_a));
    this.normal = Vector3.create();

    for (var i = 0; i < lights.length; i++) {
      var light = lights[i];
      if (light.source() != "Ambient") {
        if (light.source() == "Point") {
          var direzione = Vector3.subtract([], light.position, this.a); // uso a come esempio ma dovrebbe funzionare con tutto
        } 
        else if (light.source() == "Directional") {
          var direzione = Vector3.create();
          direzione[0] = - light.direction[0];
          direzione[1] = - light.direction[1];
          direzione[2] = - light.direction[2];
        }
  
        if ( Vector3.dot(direzione, normal_1) > 0 )
          this.normal = normal_1;
        else
          this.normal = normal_2;
      }
    }
  }

  intersects(ray) {

    if (DEBUG) console.warn("TRIAN"+this.ID);

    var A = Matrix3.fromValues(
      this.a[0]-this.b[0], this.a[0]-this.c[0], ray.dir[0],
      this.a[1]-this.b[1], this.a[1]-this.c[1], ray.dir[1],
      this.a[2]-this.b[2], this.a[2]-this.c[2], ray.dir[2]
    );

    var B = new Float32Array([
      this.a[0]-ray.a[0],
      this.a[1]-ray.a[1],
      this.a[2]-ray.a[2]
    ])
    
    // metodo di Cramer come sul libro
    // A
    // a = 0    d = 1    g = 2
    // b = 3    e = 4    h = 5
    // c = 6    f = 7    i = 8

    // B
    // j = 0
    // k = 1
    // l = 2

    var ei_hf = A[4]*A[8] - A[5]*A[7];
    var gf_di = A[2]*A[7] - A[1]*A[8];
    var dh_eg = A[1]*A[5] - A[4]*A[2];

    var ak_jb = A[0]*B[1] - B[0]*A[3];
    var jc_al = B[0]*A[6] - A[0]*B[2];
    var bl_kc = A[3]*B[2] - B[1]*A[6];

    var M = A[0]*( ei_hf ) + A[3]*( gf_di ) + A[6]*( dh_eg ); //
    var beta = ( B[0]*( ei_hf ) + B[1]*( gf_di ) + B[2]*( dh_eg ) )/M; //
    var gamma = ( A[8]*( ak_jb ) + A[5]*( jc_al ) + A[2]*( bl_kc ) )/M; //
    var t = - ( A[7]*( ak_jb ) + A[4]*( jc_al ) + A[1]*( bl_kc ) )/M; //

    if (DEBUG) console.log("beta: "+beta+" gamma: "+gamma);
    if (DEBUG) console.log("t: "+t);

    if (beta > 0 && gamma > 0 && beta+gamma < 1) { // intersezione

      //Validazione tmin tmax
      if (t > EPSILON && t >= T_MINIMO && t <= ray.tmax) return t;
      else return false;
    }
    else return false;
  }

  getNormal(point) {
    //return Vector3.scale([], this.normal, -1); //TEST inverte direzione normale
    return this.normal;
  }

}

//Ray-Intersect
class Ray {
  constructor(a,dir,tmax) {
    this.a = a; //origine
    this.dir = Vector3.normalize([],dir); //direzione
    this.tmax = tmax; //max valore per cui il raggio è valido (TEST)
  }
  
  pointAt(t) {
    //return A + t * d
    var tmp = Vector3.create();
    //tmp = Vector3.add([],this.a,Vector3.scale([],this.dir,t)); //non si capisce niente così
    
    tmp[0] = this.a[0] + t * this.dir[0];
    tmp[1] = this.a[1] + t * this.dir[1];
    tmp[2] = this.a[2] + t * this.dir[2];
    
    //if (test < 10) console.log("p(+"+t+"): ["+tmp+"] direzione: "+this.dir);
    return tmp;
  };
  
  getOrigin() {return this.a;}
  getDirection() {return Vector3.normalize([],this.dir);}
  
}

class Intersection{ //associa raggio-superficie-intersezione(t) per dimezzare le trasformazioni del raggio
  constructor(surface, ray, t) {
    this.surface = surface;
    this.ray = ray;
    this.t = t;
  }
}

//Lighting
class Light{
  constructor(color) {
    this.color = color;
  }
}
class AmbientLight extends Light {
  constructor(color) {
    super(color);
  }

  source() {return "Ambient";}
}

class PointLight extends Light{
  constructor(color, position) {
    super(color);
    this.position = position;
  }

  source() {return "Point";}

  getDirection(point) {
    var d = Vector3.subtract([], point, this.position);
    return Vector3.normalize([], d);
  }
}

class DirectionalLight extends Light{
  constructor(color, direction) {
    super(color);
    this.direction = direction;
  }

  source() {return "Directional";}

  getDirection(point) {
    return Vector3.normalize([],this.direction);
  }
}


// class Material { //É sufficiente usare le struct caricate dal json
//   constructor(ka, kd, ks, shininess) {
//     this.ka = ka;
//     this.kd = kd;
//     this.ks = ks;
//     this.shininess = shininess;
//   }
// }


//initializes the canvas and drawing buffers
function init() {
  canvas = $('#canvas')[0];
  context = canvas.getContext("2d");
  imageBuffer = context.createImageData(canvas.width, canvas.height); //buffer for pixels
  
  //TEST Renderizza automaticamente al caricamento
  //loadSceneFile('assets/'+$('#scene_file_input').val()+'.json');

  //render();
}


//loads and "parses" the scene file at the given path
function loadSceneFile(filepath) {
  var scene = Utils.loadJSON(filepath); //load the scene

  //set up camera
  aspect = scene.camera.aspect;
  camera = new Camera(scene.camera.eye, scene.camera.up, scene.camera.at, scene.camera.fovy);

  //set up lights
  lights = [];
  for (var i = 0; i < scene.lights.length; i++) {
    var light = scene.lights[i];
    if (light.source == "Ambient") {
      lights.push(new AmbientLight(light.color));
    }
    else if (light.source == "Point")  {
      lights.push(new PointLight(light.color, light.position));
    }
    else if (light.source == "Directional") {
      lights.push(new DirectionalLight(light.color, light.direction));
    }
  }
 
  //set up surfaces
  surfaces = [];
  for (var i = 0; i < scene.surfaces.length; i++) {
    //trova il materiale associato alla superficie
    var mat = scene.materials[0];
    if ( scene.surfaces[i].hasOwnProperty('name') ) {
      // console.log("nome si");
      for (var j=0; j < scene.materials.length; j++)
        if (scene.materials[j].name == scene.surfaces[i].name) mat = scene.materials[j];
    }
    else if ( scene.surfaces[i].hasOwnProperty('material') ) {
      mat = scene.materials[scene.surfaces[i].material];
    }
    else if (i >= scene.materials.length) {
      // console.log("prendi ultimo materiale");
      mat = scene.materials[scene.materials.length-1];
    }
    else mat = scene.materials[i];
    

    var transforms = [];
    // console.log(scene.surfaces[i].transforms.length);
    if ( scene.surfaces[i].hasOwnProperty('transforms') ) {
      for (var j = 0; j < scene.surfaces[i].transforms.length; j++) {
        transforms.push(scene.surfaces[i].transforms[j]);
      }
    }
    
    //crea oggetto corrispondente
    if (scene.surfaces[i].shape == "Sphere") {
      surfaces.push(new Sphere(scene.surfaces[i].center, scene.surfaces[i].radius, mat, transforms, i));
    }
    if (scene.surfaces[i].shape == "Triangle") {
      surfaces.push(new Triangle(scene.surfaces[i].p1, scene.surfaces[i].p2, scene.surfaces[i].p3, mat, transforms, i));
    }

  }

  // materials = [];
  // for (var i = 0; i < scene.materials.length; i++) {
  //   materials.push(new Material(scene.materials[i].ka, scene.materials[i].kd, scene.materials[i].ks, scene.materials[i].shininess));
  // }

  //altri parametri
  height = 2*Math.tan(rad(camera.fovy/2.0));
  width = height * aspect;
  shadow_bias = scene.shadow_bias;
  bounce_depth = scene.bounce_depth;

  //TEST Carica immagine comparativa
  var testname = 'examples/'+$('#scene_file_input').val()+'.png'
  var _img = document.getElementById('example');
  var newImg = new Image;
  newImg.onload = function() {
      _img.src = this.src;
  }
  newImg.src = testname;

}


function render() {
  var u,v, ray, color, bias, bounce;
  //backgroundcolor = [0, 1, 0.2]; //TEST contrasto superfici nere
  var bias = 0.5005;    //allinea (u,v) al centro del pixel. 
                        //Un valore leggermente > 0.5 riduce gli effetti degl errori di approsimazione (linee nere)
  
  var start = Date.now(); //for logging

  for (var j = 0; j < canvas.height; j++) { //indice bordo sinistro se i=0 (bordo destro se i = nx-1)
    for (var i = 0; i < canvas.width;  i++) {
      bounce = 0;
      u = ( width * (i + bias) / (canvas.width) ) - width / 2.0;
      v = ( -height * (j + bias) / (canvas.height) ) + height / 2.0;
      
      ray = camera.castRay(u, v);
      color = hit(ray, bounce);
      setPixel(i, j, color);

    }
  }

  //render the pixels that have been set
  context.putImageData(imageBuffer,0,0);

  var end = Date.now(); //for logging
  $('#log').html("rendered in: "+(end-start)+"ms");
  console.log("rendered in: "+(end-start)+"ms");

}

function hit(ray, bounce) {
  //Calcola l'intersezione raggio-scena
  var t_near = false; var k_near = 0, ray_near = null;     
  for (var k = 0; k < surfaces.length; k++) {
    //trasforma il raggio per rispettare le trasformazioni della superficie corrente
    var ray_trans = surfaces[k].transformRay(ray);
    
    //Intersezione con l'oggetto corrente
    var t = surfaces[k].intersects(ray_trans);
    
    //Ricorda l'oggetto intersecato che si trova più vicino alla camera 
    //per calcolare il colore del pixel
    if (t != false && (t_near == false ||  t <= t_near)) {
      t_near = t;
      k_near = k;
      var ray_near = ray_trans; //per non ricalcolarlo più tardi
    }
  }
    
  if (t_near == false) return backgroundcolor;
  else {
    //* SHADING
    ray_trans = ray_near;
    
    //Applico le trasformazioni a pto intersecato e normale
    var point = ray_trans.pointAt(t_near);
    var point_trans = surfaces[k_near].transformPoint(point);
    
    var n = surfaces[k_near].getNormal(point);
    var n_trans = Vector3.normalize([], surfaces[k_near].transformNormal(n));

    //Invocazione shader
    return surfaces[k_near].shade(ray_trans, point_trans, n_trans, bounce);
  }
}

//sets the pixel at the given x,y to the given color
/**
 * Sets the pixel at the given screen coordinates to the given color
 * @param {int} x     The x-coordinate of the pixel
 * @param {int} y     The y-coordinate of the pixel
 * @param {float[3]} color A length-3 array (or a vec3) representing the color. Color values should floating point values between 0 and 1
 */
function setPixel(x, y, color){
  var i = (y*imageBuffer.width + x)*4;
  imageBuffer.data[i] = (color[0]*255) | 0;
  imageBuffer.data[i+1] = (color[1]*255) | 0;
  imageBuffer.data[i+2] = (color[2]*255) | 0;
  imageBuffer.data[i+3] = 255; //(color[3]*255) | 0; //switch to include transparency
}

//converts degrees to radians
function rad(degrees){
  return degrees*Math.PI/180;
}

//on load, run the application
$(document).ready(function(){
  init();

  //load and render new scene
  $('#load_scene_button').click(function(){
    var filepath = 'assets/'+$('#scene_file_input').val()+'.json';
    surfaces = [];
    loadSceneFile(filepath);
    render();
  });

  //TEST switch tra immagine renderizzata ed esempio
  $('#example_button').click(function() {
  
    $('#example').toggle();
    $('#canvas').toggle();
    $('#test').toggle();

  });

  //debugging - cast a ray through the clicked pixel with DEBUG messaging on
  $('#canvas').click(function(e){
    var x = e.pageX - $('#canvas').offset().left;
    var y = e.pageY - $('#canvas').offset().top;
    DEBUG = true;
    //backgroundcolor = [0, 1, 0.2]; //TEST contrasto superfici nere
    var timer = Date.now(); //for logging
   
    var ray, color;
    var bounce = 0;
      

    //fire a ray though each pixel
    var ray = camera.castRay(x, y);
    console.log("OK");
    color = hit(ray, bounce);
    console.log("colore ottenuto: "+color);
    setPixel(x, y, color);
     
    DEBUG = false;

    timer -= Date.now();
    console.log("render in "+timer+"s");

  });

});