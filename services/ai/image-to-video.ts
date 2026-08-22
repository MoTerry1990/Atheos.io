/**
 * Animating a still without redrawing it.
 *
 * ## The failure this exists to prevent
 *
 * Image-to-video models are still text-to-video models underneath. Given a
 * source frame and a prompt they will happily re-imagine the scene on every
 * frame — the car changes shade, the coastline rearranges itself, the driver
 * becomes a different person — because nothing in the request told them the
 * picture was the point and the motion was the only thing to add.
 *
 * So the controls here are almost all **negative space**: they say what must
 * not change. That is the opposite of how a text-to-video prompt is written,
 * and it is why this is a separate module rather than a flag on the other one.
 *
 * ## Preservation is a request, not a guarantee
 *
 * `seedance-1-lite` is the only shipped model that accepts an image at all, and
 * what it offers is `image` (first frame), `last_frame_image`, `reference_images`
 * and a `camera_fixed` boolean. There is no identity lock, no composition lock
 * and no "keep the palette" input. Everything below is therefore expressed as
 * prompt and negative-prompt text plus the two structural inputs the schema
 * really has.
 *
 * Sprint 5D's audit put it plainly: `reference_images` steers appearance and is
 * not an identity lock. Calling it one would be the overclaim this whole
 * addendum exists to prevent.
 */

/** What the user asked to keep from the source image. */
export interface PreservationControls {
  /** Framing, subject placement, horizon line. */
  composition: boolean;
  /** Faces, hair, clothing — the people. */
  character: boolean;
  /** Colour, model, badges, wheels — the object. */
  vehicleOrObject: boolean;
  /** Time of day, direction and hardness of light, weather. */
  lightingAndWeather: boolean;
  /** Terrain, coastline, buildings, road layout. */
  landscape: boolean;
  /** Overall colour grade. */
  colorPalette: boolean;
}

/** Everything preserved. The right default for animating a picture somebody
 *  already chose: they liked it, so change only what they asked to change. */
export const PRESERVE_ALL: PreservationControls = {
  composition: true,
  character: true,
  vehicleOrObject: true,
  lightingAndWeather: true,
  landscape: true,
  colorPalette: true,
};

export interface MotionControls {
  /** The camera does not move. Maps to `camera_fixed` where the model has it. */
  cameraLocked: boolean;
  /** Requested camera movement. Ignored when `cameraLocked`. */
  cameraMotion: string;
  /** What the subject does. The one thing that is meant to change. */
  subjectMotion: string;
  motionStrength: "subtle" | "moderate" | "strong";
  durationSeconds: number;
  aspectRatio: string;
  qualityMode: "draft" | "quality" | "pro";
}

export interface ImageToVideoRequest {
  sourceImageUrl: string;
  /** Optional closing frame, for a defined start-to-end move. */
  lastFrameImageUrl?: string;
  preserve: PreservationControls;
  motion: MotionControls;
  /** Free text describing the desired motion, in any language. */
  prompt: string;
}

/**
 * The phrases that hold a source image still.
 *
 * Written as positive statements rather than negations wherever possible —
 * "identical vehicle" beats "do not change the vehicle", because a caption
 * model conditions on the words present, and "change the vehicle" is a phrase
 * present in the second one.
 */
const PRESERVATION_PHRASES: Record<keyof PreservationControls, string> = {
  composition:
    "identical framing and composition to the source image, same horizon line",
  character: "identical person, same face, same hair, same clothing throughout",
  vehicleOrObject:
    "identical vehicle, same colour, same model, same wheels in every frame",
  lightingAndWeather:
    "identical lighting, same time of day, same shadow direction, same weather",
  landscape:
    "identical landscape and background layout, nothing added or removed",
  colorPalette: "identical colour grade throughout",
};

/**
 * Negatives that correspond to each preservation control.
 *
 * Paired deliberately: turning a control on adds both the positive phrase and
 * the matching prohibition, because the two do different work. The positive
 * describes the target; the negative names the specific way this model tends
 * to miss it.
 */
const PRESERVATION_NEGATIVES: Record<keyof PreservationControls, string[]> = {
  composition: ["reframing", "zooming", "recomposing the shot"],
  character: [
    "different person",
    "changing face",
    "extra passengers appearing",
    "identity drift",
  ],
  vehicleOrObject: [
    "vehicle shape changes",
    "colour shifting",
    "different car model",
    "wheel deformation",
  ],
  lightingAndWeather: [
    "changing light",
    "shadows moving direction",
    "weather changing",
  ],
  landscape: [
    "changing landscape",
    "road deformation",
    "background morphing",
    "buildings appearing",
  ],
  colorPalette: ["frame-to-frame color shifts", "flickering colours"],
};

export interface RenderedImageToVideo {
  prompt: string;
  negative: string;
  /** Structural inputs the adapter should set, where the model has them. */
  inputs: {
    image: string;
    lastFrameImage?: string;
    cameraFixed: boolean;
    durationSeconds: number;
    aspectRatio: string;
  };
  /** Preservation asked for that this model cannot structurally honour. */
  unsupported: string[];
}

/**
 * Turn an animate-this-picture request into what a provider actually receives.
 *
 * Motion goes first and stays short. Everything else in the prompt is telling
 * the model to leave the picture alone, and a caption whose first clause is a
 * list of prohibitions produces a still frame — the opposite failure, but a
 * failure. So: what to do, then what to keep.
 */
export function renderImageToVideo(
  request: ImageToVideoRequest,
  capabilities: {
    startFrame: boolean;
    endFrame: boolean;
    cameraControl: boolean;
    negativePrompt: boolean;
  },
): RenderedImageToVideo {
  const motion = request.motion.cameraLocked
    ? "the camera does not move"
    : request.motion.cameraMotion;

  const kept: string[] = [];
  const negatives: string[] = [];

  for (const key of Object.keys(
    request.preserve,
  ) as (keyof PreservationControls)[]) {
    if (!request.preserve[key]) continue;
    kept.push(PRESERVATION_PHRASES[key]);
    negatives.push(...PRESERVATION_NEGATIVES[key]);
  }

  // Always, regardless of controls: these are never wanted and never asked for.
  negatives.push("scene cuts", "morphing", "flickering", "speed warping");

  const unsupported: string[] = [];
  if (!capabilities.startFrame) {
    unsupported.push(
      "this model cannot take a source frame, so nothing anchors the scene",
    );
  }
  if (request.lastFrameImageUrl && !capabilities.endFrame) {
    unsupported.push("this model cannot take a closing frame");
  }
  if (request.motion.cameraLocked && !capabilities.cameraControl) {
    unsupported.push(
      "this model has no camera-lock input; the request is prompt text only",
    );
  }
  if (!capabilities.negativePrompt) {
    /**
     * Dropped, not appended — and said so plainly.
     *
     * The adapter has no negative input to send these to, and does not fold
     * them into the prompt text. Appending "no extra passengers" to a caption
     * is a real technique and it also backfires on some models, which
     * condition on the words rather than the negation. Choosing between those
     * needs a measured comparison, and this addendum forbids paid generations.
     *
     * Until that comparison happens, the honest report is that the prohibition
     * did not reach the model at all. The red-car clip bears this out: "extra
     * passengers" was in the negative set and the result had two occupants.
     */
    unsupported.push(
      "this model has no negative prompt input, so these prohibitions are not sent to the provider",
    );
  }

  const promptParts = [
    request.motion.subjectMotion || request.prompt,
    motion,
    `${request.motion.motionStrength} motion`,
    ...kept,
  ].filter(Boolean);

  const negative = [...new Set(negatives)].join(", ");

  return {
    prompt: promptParts.join(", "),
    negative,
    inputs: {
      image: request.sourceImageUrl,
      ...(request.lastFrameImageUrl && capabilities.endFrame
        ? { lastFrameImage: request.lastFrameImageUrl }
        : {}),
      cameraFixed: request.motion.cameraLocked,
      durationSeconds: request.motion.durationSeconds,
      aspectRatio: request.motion.aspectRatio,
    },
    unsupported,
  };
}
