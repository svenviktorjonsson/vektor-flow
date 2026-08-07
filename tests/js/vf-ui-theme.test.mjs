import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createUiTheme,
  themeDisplayColor,
  uiThemePalette
} from '../../web/vf-ui/vf-ui-theme.mjs';

test('VKF owns mutable light/dark theme state and semantic drawing palettes', () => {
  const theme = createUiTheme({ theme: 'dark' });

  assert.equal(theme.snapshot().theme, 'dark');
  assert.equal(theme.set('light').theme, 'light');
  assert.equal(theme.toggle().theme, 'dark');
  assert.equal(uiThemePalette('dark').canvasBackground, '#000000');
  assert.equal(uiThemePalette('light').canvasBackground, '#f4f4f0');
  assert.notEqual(uiThemePalette('dark').grid, uiThemePalette('light').grid);
  assert.ok(Object.isFrozen(uiThemePalette('light')));
});

test('light themes invert supplied achromatic defaults without destroying chromatic defaults', () => {
  assert.equal(themeDisplayColor('#ffffff', {
    theme: 'light',
    defaultColors: ['#ffffff']
  }), '#000000');
  assert.equal(themeDisplayColor('#bfc5d0', {
    theme: 'light',
    defaultColors: ['#bfc5d0']
  }), '#2b2d2f');
  assert.equal(themeDisplayColor('#ff4444', {
    theme: 'light',
    defaultColors: ['#ff4444']
  }), '#ff4444');
  assert.equal(themeDisplayColor('#ffffff', {
    theme: 'dark',
    defaultColors: ['#ffffff']
  }), '#ffffff');
});

test('applied color adaptation is opt-in and preserves chromatic hue', () => {
  assert.equal(themeDisplayColor('#333333', { theme: 'light' }), '#333333');
  assert.equal(themeDisplayColor('#333333', {
    theme: 'light',
    adaptAppliedColors: true
  }), '#cccccc');
  assert.equal(themeDisplayColor('#ff0000', {
    theme: 'light',
    adaptAppliedColors: true
  }), '#000000');
  assert.equal(themeDisplayColor('#aa2222', {
    theme: 'light',
    adaptAppliedColors: true
  }), '#551111');
  assert.equal(themeDisplayColor('rgba(32, 32, 32, 0.5)', {
    theme: 'light',
    adaptAppliedColors: true
  }), 'rgba(223, 223, 223, 0.5)');
});

test('HSB adaptation preserves hue and saturation while replacing B with 1-B', () => {
  assert.equal(themeDisplayColor('#804020', {
    theme: 'light',
    adaptAppliedColors: true
  }), '#7f4020');
});
