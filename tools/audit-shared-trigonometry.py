"""Audit observations against mpmath; no compiler implementation changes.

Inputs are exact binary64 bits, not decimal reconstructions. Reference results
are evaluated independently at 400 and 600 decimal digits and their rounded
binary64 bits must agree. This sampling is evidence, not a correct-rounding proof.
"""
import json
import math
import struct
import sys
import mpmath as mp

def number(bits):
    return struct.unpack('>d', bytes.fromhex(bits))[0]

def bits(value):
    return struct.pack('>d', value).hex()

def ordered(value):
    raw = int(bits(value), 16)
    return (~raw & ((1 << 64) - 1)) if raw & (1 << 63) else raw | (1 << 63)

data = json.load(open(sys.argv[1] if len(sys.argv)>1 else 'build/shared-trigonometry-observations.json'))
groups = {}
special = []
rounding_disagreements = 0
for row in data['rows']:
    x = number(row['input'])
    if not math.isfinite(x):
        special.append({**row, 'allNaN': all(math.isnan(number(row[k])) for k in ['nativeSin','nativeCos','wasmSin','wasmCos'])})
        continue
    for name in ['Sin', 'Cos']:
        fn = mp.sin if name == 'Sin' else mp.cos
        with mp.workdps(400):
            reference400 = float(fn(mp.mpf(x)))
        with mp.workdps(600):
            exact = fn(mp.mpf(x))
            reference = float(exact)
            if bits(reference400) != bits(reference):
                rounding_disagreements += 1
            # mpmath does not retain a signed zero; sine must retain input -0.
            if name == 'Sin' and x == 0:
                reference = x
            for group in [row['group'], 'all']:
                key = group + '/' + name.lower()
                summary = groups.setdefault(key, {'samples':0,'nativeWasmBitDifferences':0,
                    'nativeCorrectRounded':0,'wasmCorrectRounded':0,
                    'nativeMaxULP':0,'wasmMaxULP':0,'nativeMaxAbsoluteError':0,'wasmMaxAbsoluteError':0})
                summary['samples'] += 1
                summary['nativeWasmBitDifferences'] += row['native'+name] != row['wasm'+name]
                for backend in ['native', 'wasm']:
                    value = number(row[backend+name])
                    distance = abs(ordered(value)-ordered(reference))
                    error = float(abs(mp.mpf(value)-exact))
                    summary[backend+'CorrectRounded'] += bits(value) == bits(reference)
                    if distance > summary[backend+'MaxULP']:
                        summary[backend+'MaxULP'] = distance
                        summary[backend+'WorstULP'] = {'input':row['input'],'x':x,'actual':value,'reference':reference}
                    summary[backend+'MaxAbsoluteError'] = max(summary[backend+'MaxAbsoluteError'],error)
assert rounding_disagreements == 0, rounding_disagreements
result = {k:v for k,v in data.items() if k != 'rows'}
result.update({'mpmathVersion':mp.__version__,'referenceDecimalDigits':[400,600],
    'referenceRoundingDisagreements':rounding_disagreements,'groups':groups,'nonFinite':special})
json.dump(result,open(sys.argv[2] if len(sys.argv)>2 else 'build/shared-trigonometry-audit.json','w'),indent=2)
print(json.dumps(result,indent=2))
