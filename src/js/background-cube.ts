import * as THREE from "three";

export class BackgroundCube {
    private container: HTMLElement | null;
    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private renderer!: THREE.WebGLRenderer;
    private mesh!: THREE.Mesh;

    // Rotating
    private targetRotationX: number = 0;
    private targetRotationY: number = 0;
    private currentRotationX: number = 0;
    private currentRotationY: number = 0;
    private lerpFactor: number = 0.2;

    private onScroll: () => void;
    private onResize: () => void;
    private animationLoop: (time: number) => void;

    constructor(containerId: string) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            // Provide dummy functions to avoid errors if methods are called unexpectedly
            this.onScroll = () => { };
            this.onResize = () => { };
            this.animationLoop = () => { };
            return;
        }

        this.init();

        this.onScroll = () => {
            const scrollPercent = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight || 1);
            this.targetRotationX = scrollPercent * Math.PI * 2;
            this.targetRotationY = scrollPercent * Math.PI * 2;
        };

        this.onResize = () => {
            this.updateSize();
        };

        this.animationLoop = (time: number) => {
            this.animate(time);
        };

        window.addEventListener("scroll", this.onScroll);
        window.addEventListener("resize", this.onResize);
        this.renderer.setAnimationLoop(this.animationLoop);
    }

    private init(): void {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            4,
            1000
        );
        this.camera.position.z = 50;

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.updateSize();
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container!.appendChild(this.renderer.domElement);

        const geometry = new THREE.SphereGeometry(15, 32, 16);
        // const geometry = new THREE.BoxGeometry(15, 15, 15);
        const material = new THREE.MeshNormalMaterial({
            wireframe: true
        });
        this.mesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.mesh);
    }

    private updateSize(): void {
        const width = window.innerWidth * 0.95;
        const height = window.innerHeight * 0.95;
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }

    private animate(time: number): void {
        this.currentRotationX += (this.targetRotationX - this.currentRotationX) * this.lerpFactor;
        this.currentRotationY += (this.targetRotationY - this.currentRotationY) * this.lerpFactor;

        this.mesh.rotation.x = this.currentRotationX;
        this.mesh.rotation.y = this.currentRotationY;

        this.renderer.render(this.scene, this.camera);
    }

    public destroy(): void {
        this.renderer.setAnimationLoop(null);
        window.removeEventListener("scroll", this.onScroll);
        window.removeEventListener("resize", this.onResize);
        if (this.container && this.container.contains(this.renderer.domElement)) {
            this.container.removeChild(this.renderer.domElement);
        }
    }
}