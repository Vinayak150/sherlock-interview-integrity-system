import type {
  CandidateConfidenceEvaluation,
  CandidateIdentificationState,
} from '../candidateConfidence/types.js';
import type { FusionPosterior } from '../fusion/index.js';
import { applyIsotonicRegression } from './isotonicRegression.js';
import { applyPlattScaling, logit } from './plattScaling.js';
import type {
  CalibrationMethod,
  ConfidenceCalibratorOptions,
  IsotonicKnot,
  PlattScalingParameters,
} from './types.js';
import { DEFAULT_ISOTONIC_KNOTS, DEFAULT_PLATT_PARAMETERS } from './types.js';

const ABSTENTION_THRESHOLD = 0.55;

export class ConfidenceCalibrator {
  readonly enabled: boolean;
  private readonly method: CalibrationMethod;
  private readonly platt: PlattScalingParameters;
  private readonly isotonicKnots: readonly IsotonicKnot[];

  constructor(options: ConfidenceCalibratorOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.method = options.method ?? 'platt';
    this.platt = options.platt ?? DEFAULT_PLATT_PARAMETERS;
    this.isotonicKnots = options.isotonicKnots ?? DEFAULT_ISOTONIC_KNOTS;
  }

  calibrate(rawProbability: number): number {
    if (!this.enabled) {
      return rawProbability;
    }

    if (this.method === 'platt') {
      return applyPlattScaling(rawProbability, this.platt);
    }

    return applyIsotonicRegression(rawProbability, this.isotonicKnots);
  }

  calibratePosterior(posterior: FusionPosterior): FusionPosterior {
    const rawProbability = posterior.rawProbability ?? posterior.probability;
    const probability = this.calibrate(rawProbability);

    if (!this.enabled) {
      return {
        ...posterior,
        rawProbability,
        probability: rawProbability,
      };
    }

    return {
      ...posterior,
      rawProbability,
      probability,
      logOdds: logit(probability),
    };
  }

  calibrateEvaluation(evaluation: CandidateConfidenceEvaluation): CandidateConfidenceEvaluation {
    const selectedPosterior = this.calibratePosterior(evaluation.selectedPosterior);
    const rankedCandidates = evaluation.table.rankedCandidates.map((candidate) => {
      const posterior = this.calibratePosterior(candidate.posterior);
      const probability = posterior.probability;
      const identificationState: CandidateIdentificationState =
        probability >= ABSTENTION_THRESHOLD ? 'IDENTIFIED' : 'UNKNOWN';
      return {
        ...candidate,
        posterior,
        probability,
        confidence: probability,
        identificationState,
      };
    });

    return {
      ...evaluation,
      selectedPosterior,
      table: {
        ...evaluation.table,
        rankedCandidates,
        topParticipantId: rankedCandidates[0]?.participantId ?? null,
      },
    };
  }
}
