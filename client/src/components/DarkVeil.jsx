import { useEffect, useRef } from "react";

import {
    Renderer,
    Program,
    Mesh,
    Triangle,
    Vec2,
} from "ogl";

import "./DarkVeil.css";


function DarkVeil({
    hueShift = 0,
    noiseIntensity = 0.04,
    scanlineIntensity = 0.03,
    speed = 0.35,
    scanlineFrequency = 0,
    warpAmount = 0.15,
    resolutionScale = 1,
}) {

    const containerRef = useRef(null);


    useEffect(() => {

        const container =
            containerRef.current;

        if (!container) {
            return;
        }


        const renderer =
            new Renderer({
                dpr: Math.min(
                    window.devicePixelRatio || 1,
                    2
                ),
                alpha: true,
            });


        const gl = renderer.gl;


        gl.canvas.style.position =
            "absolute";

        gl.canvas.style.top =
            "0";

        gl.canvas.style.left =
            "0";

        gl.canvas.style.width =
            "100%";

        gl.canvas.style.height =
            "100%";

        gl.canvas.style.display =
            "block";


        container.appendChild(
            gl.canvas
        );


        const vertex = `
            attribute vec2 uv;
            attribute vec2 position;

            varying vec2 vUv;

            void main() {

                vUv = uv;

                gl_Position = vec4(
                    position,
                    0.0,
                    1.0
                );
            }
        `;


        const fragment = `
            precision highp float;

            uniform float uTime;
            uniform vec2 uResolution;

            uniform float uHueShift;
            uniform float uNoise;
            uniform float uScan;
            uniform float uScanFreq;
            uniform float uWarp;

            varying vec2 vUv;


            vec3 palette(float t) {

                vec3 a = vec3(
                    0.45,
                    0.40,
                    0.50
                );

                vec3 b = vec3(
                    0.45,
                    0.40,
                    0.50
                );

                vec3 c = vec3(
                    1.0,
                    1.0,
                    1.0
                );

                vec3 d = vec3(
                    0.00,
                    0.25,
                    0.55
                );

                return a +
                    b *
                    cos(
                        6.28318 *
                        (
                            c * t +
                            d
                        )
                    );
            }


            float random(vec2 st) {

                return fract(
                    sin(
                        dot(
                            st,
                            vec2(
                                12.9898,
                                78.233
                            )
                        )
                    ) *
                    43758.5453123
                );
            }


            void main() {

                vec2 uv = vUv;

                vec2 centered =
                    uv - 0.5;


                centered.x *=
                    uResolution.x /
                    uResolution.y;


                float time =
                    uTime * 0.15;


                float wave =
                    sin(
                        centered.x * 3.0 +
                        time
                    ) * 0.08;


                wave +=
                    cos(
                        centered.y * 4.0 -
                        time * 0.7
                    ) * 0.06;


                float dist =
                    length(centered);


                float glow =
                    1.0 -
                    smoothstep(
                        0.0,
                        0.95,
                        dist
                    );


                float pattern =
                    sin(
                        centered.x * 6.0 +
                        centered.y * 4.0 +
                        time
                    );


                float value =
                    0.30 +
                    glow * 0.45 +
                    pattern * 0.08 +
                    wave;


                value +=
                    random(
                        uv *
                        uResolution
                    ) *
                    uNoise;


                float scanline =
                    sin(
                        uv.y *
                        uScanFreq *
                        6.28318
                    );


                value +=
                    scanline *
                    uScan;


                value +=
                    uWarp *
                    sin(
                        uv.x * 8.0 +
                        time
                    );


                vec3 color =
                    palette(
                        value +
                        uHueShift /
                        360.0
                    );


                color *= vec3(
                    0.55,
                    0.25,
                    0.80
                );


                gl_FragColor =
                    vec4(
                        color,
                        1.0
                    );
            }
        `;


        const geometry =
            new Triangle(gl);


        const program =
            new Program(gl, {

                vertex,

                fragment,

                uniforms: {

                    uTime: {
                        value: 0,
                    },

                    uResolution: {
                        value: new Vec2(
                            window.innerWidth,
                            window.innerHeight
                        ),
                    },

                    uHueShift: {
                        value: hueShift,
                    },

                    uNoise: {
                        value: noiseIntensity,
                    },

                    uScan: {
                        value: scanlineIntensity,
                    },

                    uScanFreq: {
                        value: scanlineFrequency,
                    },

                    uWarp: {
                        value: warpAmount,
                    },
                },
            });


        const mesh =
            new Mesh(gl, {
                geometry,
                program,
            });


        const resize = () => {

            const width =
                window.innerWidth;

            const height =
                window.innerHeight;


            renderer.setSize(
                width * resolutionScale,
                height * resolutionScale
            );


            program
                .uniforms
                .uResolution
                .value
                .set(
                    width,
                    height
                );
        };


        resize();


        window.addEventListener(
            "resize",
            resize
        );


        let animationFrame;


        const animate = (time) => {

            program
                .uniforms
                .uTime
                .value =
                time *
                0.001 *
                speed;


            renderer.render({
                scene: mesh,
            });


            animationFrame =
                requestAnimationFrame(
                    animate
                );
        };


        animationFrame =
            requestAnimationFrame(
                animate
            );


        return () => {

            cancelAnimationFrame(
                animationFrame
            );


            window.removeEventListener(
                "resize",
                resize
            );


            if (
                gl.canvas &&
                gl.canvas.parentNode
            ) {

                gl.canvas.parentNode.removeChild(
                    gl.canvas
                );
            }
        };

    }, [
        hueShift,
        noiseIntensity,
        scanlineIntensity,
        speed,
        scanlineFrequency,
        warpAmount,
        resolutionScale,
    ]);


    return (
        <div
            ref={containerRef}
            className="darkveil-canvas"
        />
    );
}


export default DarkVeil;