export function rotateStokesBasis(stokes, angleRadians) {
  const cosine = Math.cos(2.0 * angleRadians);
  const sine = Math.sin(2.0 * angleRadians);
  const [intensity, q, u, circular] = stokes;
  return [
    intensity,
    q * cosine + u * sine,
    -q * sine + u * cosine,
    circular,
  ];
}

function applyMueller(matrix, stokes) {
  return matrix.map((row) => row.reduce(
    (sum, coefficient, index) => sum + coefficient * stokes[index],
    0.0,
  ));
}

export function dielectricReflectionMueller({
  nIncident,
  nTransmitted,
  cosThetaIncident,
}) {
  const sineSquaredIncident = 1.0 - cosThetaIncident ** 2;
  const sineSquaredTransmitted = (nIncident / nTransmitted) ** 2
    * sineSquaredIncident;
  if (sineSquaredTransmitted > 1.0) {
    throw new RangeError(
      "total internal reflection needs a phase-aware matrix",
    );
  }
  const cosThetaTransmitted = Math.sqrt(1.0 - sineSquaredTransmitted);
  const reflectionS = (
    nIncident * cosThetaIncident - nTransmitted * cosThetaTransmitted
  ) / (
    nIncident * cosThetaIncident + nTransmitted * cosThetaTransmitted
  );
  const reflectionP = (
    nTransmitted * cosThetaIncident - nIncident * cosThetaTransmitted
  ) / (
    nTransmitted * cosThetaIncident + nIncident * cosThetaTransmitted
  );
  const reflectanceS = reflectionS ** 2;
  const reflectanceP = reflectionP ** 2;
  const average = 0.5 * (reflectanceS + reflectanceP);
  const difference = 0.5 * (reflectanceS - reflectanceP);
  const coherence = reflectionS * reflectionP;
  return [
    [average, difference, 0.0, 0.0],
    [difference, average, 0.0, 0.0],
    [0.0, 0.0, coherence, 0.0],
    [0.0, 0.0, 0.0, coherence],
  ];
}

export function reflectDielectricStokes({
  incidentStokes = [1.0, 0.0, 0.0, 0.0],
  basisRotationRadians = 0.0,
  nIncident,
  nTransmitted,
  cosThetaIncident,
}) {
  const localIncidentStokes = rotateStokesBasis(
    incidentStokes,
    basisRotationRadians,
  );
  const mueller = dielectricReflectionMueller({
    nIncident,
    nTransmitted,
    cosThetaIncident,
  });
  return {
    incidentStokes,
    localIncidentStokes,
    mueller,
    stokes: applyMueller(mueller, localIncidentStokes),
  };
}

export function transportStokesReflections({
  incidentStokes = [1.0, 0.0, 0.0, 0.0],
  reflections,
}) {
  let stokes = incidentStokes;
  const history = reflections.map((reflection) => {
    const result = reflectDielectricStokes({
      ...reflection,
      incidentStokes: stokes,
    });
    stokes = result.stokes;
    return result;
  });
  return { stokes, history };
}
