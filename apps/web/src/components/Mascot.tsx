import laptop from "../assets/mascot/laptop.webp";
import point from "../assets/mascot/point.webp";
import search from "../assets/mascot/search.webp";
import sorry from "../assets/mascot/sorry.webp";
import success from "../assets/mascot/success.webp";
import wave from "../assets/mascot/wave.webp";
import worried from "../assets/mascot/worried.webp";

const images = { laptop, point, search, sorry, success, wave, worried };

export type MascotPose = keyof typeof images;

type Props = {
  pose: MascotPose;
  size?: "regular" | "small";
};

/** Decorative only: screen text must carry the meaning on its own. */
export function Mascot({ pose, size = "regular" }: Props) {
  return (
    <img
      className={size === "small" ? "mascot small" : "mascot"}
      src={images[pose]}
      alt=""
      data-pose={pose}
    />
  );
}
