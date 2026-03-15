import fs from 'fs';
import path from 'path';

const CATALOGS_DIR = path.join(process.cwd(), 'src/game/bloomville/catalogs');

const NEW_BUILDINGS = {
  'residential-pack.json': [
    {
      id: 'cottage_storybook',
      districts: ['residential_low'],
      weight: 2,
      lot: { frontage: [14, 20], depth: [16, 22], setback: [6, 10] },
      palette: { body: '#d4c4a8', accent: '#8a6848', roof: '#4a3c2c', glass: '#8aa0b8' },
      pieces: [
        { material: 'body', size: [9, 4, 11], offset: [0, 2, 0] },
        { material: 'accent', size: [4, 3, 4], offset: [3, 1.5, 4] }
      ],
      roof: { type: 'gable', height: 2.8, overhang: 1, material: 'roof' }
    },
    {
      id: 'cottage_english',
      districts: ['residential_low'],
      weight: 2,
      lot: { frontage: [16, 22], depth: [18, 24], setback: [5, 9] },
      palette: { body: '#e0d4c0', accent: '#7a6050', roof: '#5a4a3a', glass: '#8ca2b8' },
      pieces: [
        { material: 'body', size: [10, 3.8, 12], offset: [0, 1.9, 0] }
      ],
      roof: { type: 'gable', height: 2.5, overhang: 0.9, material: 'roof' }
    },
    {
      id: 'ranch_house',
      districts: ['residential_low'],
      weight: 3,
      lot: { frontage: [28, 40], depth: [18, 26], setback: [10, 18] },
      palette: { body: '#ccc0b0', accent: '#8a7a68', roof: '#5a5048', glass: '#8aa0b8' },
      pieces: [
        { material: 'body', size: [22, 3.5, 14], offset: [0, 1.75, 0] },
        { material: 'accent', size: [6, 3, 6], offset: [8, 1.5, 4] }
      ],
      roof: { type: 'gable', height: 1.8, overhang: 0.7, material: 'roof' }
    },
    {
      id: 'ranch_extended',
      districts: ['residential_low'],
      weight: 2,
      lot: { frontage: [32, 48], depth: [20, 28], setback: [12, 20] },
      palette: { body: '#d8ccc0', accent: '#7a6858', roof: '#585048', glass: '#8ca4b8' },
      pieces: [
        { material: 'body', size: [18, 3.2, 12], offset: [-4, 1.6, 0] },
        { material: 'body', size: [12, 3.2, 10], offset: [8, 1.6, -1] }
      ],
      roof: { type: 'gable', height: 1.6, overhang: 0.6, material: 'roof' }
    },
    {
      id: 'foursquare',
      districts: ['residential_mid'],
      weight: 3,
      lot: { frontage: [18, 26], depth: [18, 26], setback: [4, 8] },
      palette: { body: '#e0d8c8', accent: '#6a5848', roof: '#4a4850', glass: '#8aa0b8' },
      pieces: [
        { material: 'body', size: [14, 8.5, 14], offset: [0, 4.25, 0] },
        { material: 'accent', size: [14.5, 0.4, 0.6], offset: [0, 4.2, 6.8] }
      ],
      roof: { type: 'flat', height: 0.5, inset: 0.4, material: 'roof' }
    },
    {
      id: 'american_foursquare',
      districts: ['residential_mid'],
      weight: 2,
      lot: { frontage: [20, 28], depth: [20, 28], setback: [5, 10] },
      palette: { body: '#d8d0c4', accent: '#7a6858', roof: '#525058', glass: '#8ca2b8' },
      pieces: [
        { material: 'body', size: [16, 9, 16], offset: [0, 4.5, 0] },
        { material: 'accent', size: [4, 7, 3], offset: [0, 3.5, 6.8] }
      ],
      roof: { type: 'flat', height: 0.55, inset: 0.45, material: 'roof' }
    },
    {
      id: 'rowhouse_classic',
      districts: ['residential_mid'],
      weight: 4,
      lot: { frontage: [6, 10], depth: [14, 20], setback: [1, 3] },
      palette: { body: '#c8c0b4', accent: '#8a7868', roof: '#5a5650', glass: '#8aa0b8' },
      pieces: [
        { material: 'body', size: [5, 7.5, 10], offset: [0, 3.75, 0] }
      ],
      roof: { type: 'flat', height: 0.35, inset: 0.25, material: 'roof' }
    },
    {
      id: 'rowhouse_brownstone',
      districts: ['residential_mid'],
      weight: 3,
      lot: { frontage: [7, 11], depth: [16, 22], setback: [0.5, 2] },
      palette: { body: '#a08070', accent: '#706050', roof: '#4a4850', glass: '#8ca2b8' },
      pieces: [
        { material: 'body', size: [6, 8, 12], offset: [0, 4, 0] },
        { material: 'accent', size: [6.2, 0.5, 1], offset: [0, 4, 5.8] }
      ],
      roof: { type: 'flat', height: 0.4, inset: 0.3, material: 'roof' }
    },
    {
      id: 'rowhouse_victorian',
      districts: ['residential_mid'],
      weight: 2,
      lot: { frontage: [8, 12], depth: [14, 20], setback: [2, 4] },
      palette: { body: '#d8c8b0', accent: '#7a5840', roof: '#5a4838', glass: '#8aa0b8' },
      pieces: [
        { material: 'body', size: [6, 7, 10], offset: [0, 3.5, 0] },
        { material: 'accent', size: [3, 5, 3], offset: [0, 5.5, 4] }
      ],
      roof: { type: 'flat', height: 0.38, inset: 0.28, material: 'roof' }
    },
    {
      id: 'walkup_3story',
      districts: ['residential_mid', 'mixed_main'],
      weight: 3,
      lot: { frontage: [18, 26], depth: [16, 22], setback: [2, 5] },
      palette: { body: '#c8c4bc', accent: '#7a7d85', roof: '#4a4c52', glass: '#8aa0b5' },
      pieces: [
        { material: 'body', size: [14, 10.5, 12], offset: [0, 5.25, 0] },
        { material: 'accent', size: [14.5, 0.4, 0.8], offset: [0, 3.5, 5.8] },
        { material: 'accent', size: [14.5, 0.4, 0.8], offset: [0, 7, 5.8] }
      ],
      roof: { type: 'flat', height: 0.45, inset: 0.4, material: 'roof' }
    },
    {
      id: 'walkup_4story',
      districts: ['residential_high', 'mixed_main'],
      weight: 2,
      lot: { frontage: [20, 28], depth: [18, 24], setback: [2, 4] },
      palette: { body: '#bfc2c8', accent: '#6a7080', roof: '#3d3f45', glass: '#889cb2' },
      pieces: [
        { material: 'body', size: [16, 14, 14], offset: [0, 7, 0] },
        { material: 'accent', size: [16.5, 0.4, 0.8], offset: [0, 3.5, 6.8] },
        { material: 'accent', size: [16.5, 0.4, 0.8], offset: [0, 7, 6.8] },
        { material: 'accent', size: [16.5, 0.4, 0.8], offset: [0, 10.5, 6.8] }
      ],
      roof: { type: 'flat', height: 0.5, inset: 0.45, material: 'roof' }
    },
    {
      id: 'maisonette',
      districts: ['residential_mid'],
      weight: 3,
      lot: { frontage: [14, 20], depth: [14, 20], setback: [2, 5] },
      palette: { body: '#d0c8bc', accent: '#8a7868', roof: '#5a5650', glass: '#8aa0b8' },
      pieces: [
        { material: 'body', size: [11, 6.5, 11], offset: [0, 3.25, 0] },
        { material: 'accent', size: [0.6, 6, 0.5], offset: [0, 3, 5.3] }
      ],
      roof: { type: 'gable', height: 1.5, overhang: 0.5, material: 'roof' }
    },
    {
      id: 'duplex_sidebyside',
      districts: ['residential_mid'],
      weight: 2,
      lot: { frontage: [20, 28], depth: [14, 20], setback: [3, 6] },
      palette: { body: '#d5ccc0', accent: '#a89880', roof: '#5a5650', glass: '#8ea2b7' },
      pieces: [
        { material: 'body', size: [8, 6, 10], offset: [-5, 3, 0] },
        { material: 'body', size: [8, 6, 10], offset: [5, 3, 0] }
      ],
      roof: { type: 'gable', height: 1.5, overhang: 0.5, material: 'roof' }
    },
    {
      id: 'townhouse_modern',
      districts: ['residential_mid', 'residential_high'],
      weight: 3,
      lot: { frontage: [8, 12], depth: [14, 20], setback: [1.5, 4] },
      palette: { body: '#b8b4ac', accent: '#6e7078', roof: '#45474d', glass: '#869ab0' },
      pieces: [
        { material: 'body', size: [6, 9, 11], offset: [0, 4.5, 0] }
      ],
      roof: { type: 'flat', height: 0.4, inset: 0.35, material: 'roof' }
    },
    {
      id: 'townhouse_narrow',
      districts: ['residential_mid'],
      weight: 4,
      lot: { frontage: [5, 8], depth: [12, 18], setback: [1, 3] },
      palette: { body: '#ccc5b8', accent: '#8a7d6c', roof: '#4a4850', glass: '#8fa3b8' },
      pieces: [
        { material: 'body', size: [4.5, 8, 9], offset: [0, 4, 0] }
      ],
      roof: { type: 'flat', height: 0.35, inset: 0.25, material: 'roof' }
    }
  ],
  
  'commercial-food-pack.json': [
    {
      id: 'fast_food_burger',
      districts: ['mixed_main', 'commercial_general'],
      weight: 4,
      lot: { frontage: [12, 18], depth: [14, 20], setback: [3, 6] },
      palette: { body: '#d83030', accent: '#f0d838', roof: '#c82828', glass: '#8aa8c0' },
      pieces: [
        { material: 'body', size: [10, 4, 12], offset: [0, 2, 0] },
        { material: 'accent', size: [10.5, 0.8, 0.4], offset: [0, 3.2, 5.8] }
      ],
      roof: { type: 'flat', height: 0.35, inset: 0.28, material: 'roof' }
    },
    {
      id: 'fast_food_chicken',
      districts: ['mixed_main', 'commercial_general'],
      weight: 3,
      lot: { frontage: [12, 18], depth: [14, 20], setback: [3, 6] },
      palette: { body: '#c85028', accent: '#f0e8d8', roof: '#a84020', glass: '#8aa8c0' },
      pieces: [
        { material: 'body', size: [10, 4.2, 12], offset: [0, 2.1, 0] }
      ],
      roof: { type: 'flat', height: 0.35, inset: 0.28, material: 'roof' }
    },
    {
      id: 'fast_food_taco',
      districts: ['mixed_main', 'commercial_general'],
      weight: 3,
      lot: { frontage: [10, 16], depth: [12, 18], setback: [2, 5] },
      palette: { body: '#783898', accent: '#f0d838', roof: '#603080', glass: '#8aa8c0' },
      pieces: [
        { material: 'body', size: [8, 4, 10], offset: [0, 2, 0] }
      ],
      roof: { type: 'flat', height: 0.32, inset: 0.25, material: 'roof' }
    },
    {
      id: 'pizza_takeout',
      districts: ['mixed_main'],
      weight: 4,
      lot: { frontage: [8, 14], depth: [10, 16], setback: [1, 3] },
      palette: { body: '#c83828', accent: '#388838', roof: '#a83020', glass: '#88a4bc' },
      pieces: [
        { material: 'body', size: [7, 4.2, 9], offset: [0, 2.1, 0] }
      ],
      roof: { type: 'flat', height: 0.32, inset: 0.24, material: 'roof' }
    },
    {
      id: 'chinese_takeout',
      districts: ['mixed_main', 'residential_mid'],
      weight: 4,
      lot: { frontage: [8, 12], depth: [10, 14], setback: [0.5, 2] },
      palette: { body: '#c82828', accent: '#f0d838', roof: '#a82020', glass: '#8aa8c0' },
      pieces: [
        { material: 'body', size: [6, 4, 8], offset: [0, 2, 0] }
      ],
      roof: { type: 'flat', height: 0.3, inset: 0.22, material: 'roof' }
    },
    {
      id: 'sushi_bar',
      districts: ['mixed_main'],
      weight: 3,
      lot: { frontage: [10, 14], depth: [12, 16], setback: [1, 3] },
      palette: { body: '#f0e8dc', accent: '#c83838', roof: '#484850', glass: '#8aa8c0' },
      pieces: [
        { material: 'body', size: [8, 4.2, 10], offset: [0, 2.1, 0] }
      ],
      roof: { type: 'flat', height: 0.32, inset: 0.25, material: 'roof' }
    },
    {
      id: 'thai_restaurant',
      districts: ['mixed_main'],
      weight: 3,
      lot: { frontage: [10, 16], depth: [12, 18], setback: [1, 3] },
      palette: { body: '#e8dcc8', accent: '#b86828', roof: '#585040', glass: '#8aa8c0' },
      pieces: [
        { material: 'body', size: [8, 4.5, 11], offset: [0, 2.25, 0] }
      ],
      roof: { type: 'gable', height: 1.5, overhang: 0.6, material: 'roof' }
    },
    {
      id: 'indian_restaurant',
      districts: ['mixed_main'],
      weight: 3,
      lot: { frontage: [12, 18], depth: [14, 20], setback: [1, 4] },
      palette: { body: '#f0e0c8', accent: '#c86828', roof: '#684830', glass: '#8aa8c0' },
      pieces: [
        { material: 'body', size: [10, 5, 12], offset: [0, 2.5, 0] }
      ],
      roof: { type: 'flat', height: 0.4, inset: 0.32, material: 'roof' }
    },
    {
      id: 'mexican_restaurant',
      districts: ['mixed_main'],
      weight: 3,
      lot: { frontage: [12, 18], depth: [14, 20], setback: [2, 5] },
      palette: { body: '#e8d8c0', accent: '#c84838', roof: '#b87848', glass: '#8aa8c0' },
      pieces: [
        { material: 'body', size: [10, 4.5, 12], offset: [0, 2.25, 0] }
      ],
      roof: { type: 'flat', height: 0.38, inset: 0.3, material: 'roof' }
    },
    {
      id: 'italian_restaurant',
      districts: ['mixed_main'],
      weight: 2,
      lot: { frontage: [14, 20], depth: [16, 22], setback: [2, 5] },
      palette: { body: '#e8d8c4', accent: '#784828', roof: '#685038', glass: '#8aa8c0' },
      pieces: [
        { material: 'body', size: [12, 5.5, 14], offset: [0, 2.75, 0] }
      ],
      roof: { type: 'gable', height: 2, overhang: 0.8, material: 'roof' }
    },
    {
      id: 'diner_classic',
      districts: ['mixed_main', 'commercial_general'],
      weight: 3,
      lot: { frontage: [14, 20], depth: [12, 18], setback: [4, 8] },
      palette: { body: '#c8c0b4', accent: '#c84838', roof: '#505058', glass: '#88a4bc' },
      pieces: [
        { material: 'body', size: [11, 4, 10], offset: [0, 2, 0] }
      ],
      roof: { type: 'flat', height: 0.35, inset: 0.28, material: 'roof' }
    },
    {
      id: 'diner_retro',
      districts: ['mixed_main'],
      weight: 2,
      lot: { frontage: [16, 22], depth: [14, 18], setback: [5, 10] },
      palette: { body: '#4888b8', accent: '#f0d848', roof: '#3878a8', glass: '#8aa8c0' },
      pieces: [
        { material: 'body', size: [12, 4.2, 11], offset: [0, 2.1, 0] }
      ],
      roof: { type: 'flat', height: 0.38, inset: 0.3, material: 'roof' }
    },
    {
      id: 'ice_cream_shop',
      districts: ['mixed_main', 'residential_mid'],
      weight: 3,
      lot: { frontage: [8, 12], depth: [10, 14], setback: [0.5, 2] },
      palette: { body: '#f0e8f8', accent: '#c868c8', roof: '#505860', glass: '#8aa8c0' },
      pieces: [
        { material: 'body', size: [6, 4, 8], offset: [0, 2, 0] }
      ],
      roof: { type: 'flat', height: 0.3, inset: 0.22, material: 'roof' }
    },
    {
      id: 'donut_shop',
      districts: ['mixed_main', 'residential_mid'],
      weight: 3,
      lot: { frontage: [10, 14], depth: [10, 14], setback: [1, 3] },
      palette: { body: '#f8a858', accent: '#c85828', roof: '#e89848', glass: '#8aa8c0' },
      pieces: [
        { material: 'body', size: [8, 4, 8], offset: [0, 2, 0] }
      ],
      roof: { type: 'flat', height: 0.32, inset: 0.25, material: 'roof' }
    },
    {
      id: 'bagel_shop',
      districts: ['mixed_main', 'residential_mid'],
      weight: 3,
      lot: { frontage: [8, 12], depth: [10, 14], setback: [0.5, 2] },
      palette: { body: '#e8dcc8', accent: '#a86838', roof: '#504840', glass: '#8aa8c0' },
      pieces: [
        { material: 'body', size: [6, 4.2, 8], offset: [0, 2.1, 0] }
      ],
      roof: { type: 'flat', height: 0.3, inset: 0.22, material: 'roof' }
    }
  ],
  
  'industrial-pack.json': [
    {
      id: 'small_workshop',
      districts: ['industrial_light'],
      weight: 4,
      lot: { frontage: [12, 18], depth: [14, 20], setback: [2, 5] },
      palette: { body: '#b8b0a4', accent: '#686860', roof: '#585850', glass: '#8aa0b5' },
      pieces: [
        { material: 'body', size: [10, 5, 12], offset: [0, 2.5, 0] }
      ],
      roof: { type: 'flat', height: 0.32, inset: 0.25, material: 'roof' }
    },
    {
      id: 'cabinet_shop',
      districts: ['industrial_light'],
      weight: 2,
      lot: { frontage: [18, 26], depth: [20, 28], setback: [4, 8] },
      palette: { body: '#c0b4a4', accent: '#786858', roof: '#585550', glass: '#8aa0b5' },
      pieces: [
        { material: 'body', size: [14, 6, 16], offset: [0, 3, 0] },
        { material: 'accent', size: [14.5, 0.5, 0.5], offset: [0, 4.2, 7.8] }
      ],
      roof: { type: 'flat', height: 0.38, inset: 0.3, material: 'roof' }
    },
    {
      id: 'metal_fabrication',
      districts: ['industrial_light', 'industrial_heavy'],
      weight: 2,
      lot: { frontage: [22, 32], depth: [24, 36], setback: [5, 10] },
      palette: { body: '#a0a098', accent: '#585850', roof: '#505048', glass: '#889cb0' },
      pieces: [
        { material: 'body', size: [18, 7, 20], offset: [0, 3.5, 0] },
        { material: 'accent', size: [6, 5, 5], offset: [0, 2.5, 8] }
      ],
      roof: { type: 'flat', height: 0.4, inset: 0.32, material: 'roof' }
    },
    {
      id: 'plumbing_supply',
      districts: ['industrial_light'],
      weight: 3,
      lot: { frontage: [18, 28], depth: [20, 30], setback: [4, 8] },
      palette: { body: '#b8b0a0', accent: '#4878a8', roof: '#585850', glass: '#8aa0b5' },
      pieces: [
        { material: 'body', size: [14, 6, 16], offset: [0, 3, 0] }
      ],
      roof: { type: 'flat', height: 0.38, inset: 0.3, material: 'roof' }
    },
    {
      id: 'electrical_supply',
      districts: ['industrial_light'],
      weight: 3,
      lot: { frontage: [16, 24], depth: [18, 26], setback: [3, 7] },
      palette: { body: '#c0b8a8', accent: '#f0c828', roof: '#585850', glass: '#8aa0b5' },
      pieces: [
        { material: 'body', size: [12, 5.5, 14], offset: [0, 2.75, 0] }
      ],
      roof: { type: 'flat', height: 0.35, inset: 0.28, material: 'roof' }
    },
    {
      id: 'auto_parts',
      districts: ['industrial_light'],
      weight: 3,
      lot: { frontage: [20, 30], depth: [22, 32], setback: [5, 10] },
      palette: { body: '#b0a898', accent: '#c84828', roof: '#505048', glass: '#8aa0b5' },
      pieces: [
        { material: 'body', size: [16, 6.5, 18], offset: [0, 3.25, 0] }
      ],
      roof: { type: 'flat', height: 0.4, inset: 0.32, material: 'roof' }
    },
    {
      id: 'tire_shop',
      districts: ['industrial_light'],
      weight: 3,
      lot: { frontage: [18, 26], depth: [18, 26], setback: [4, 8] },
      palette: { body: '#c8c0b4', accent: '#c84828', roof: '#505048', glass: '#8aa0b5' },
      pieces: [
        { material: 'body', size: [14, 5.5, 14], offset: [0, 2.75, 0] }
      ],
      roof: { type: 'flat', height: 0.36, inset: 0.28, material: 'roof' }
    },
    {
      id: 'upholstery_shop',
      districts: ['industrial_light'],
      weight: 2,
      lot: { frontage: [14, 22], depth: [16, 24], setback: [3, 6] },
      palette: { body: '#c4b8a8', accent: '#885848', roof: '#585550', glass: '#8aa0b5' },
      pieces: [
        { material: 'body', size: [11, 5, 13], offset: [0, 2.5, 0] }
      ],
      roof: { type: 'flat', height: 0.34, inset: 0.26, material: 'roof' }
    },
    {
      id: 'sign_shop',
      districts: ['industrial_light', 'mixed_main'],
      weight: 2,
      lot: { frontage: [14, 22], depth: [16, 22], setback: [2, 5] },
      palette: { body: '#b8b4ac', accent: '#4868a8', roof: '#505058', glass: '#8aa0b5' },
      pieces: [
        { material: 'body', size: [11, 5.5, 12], offset: [0, 2.75, 0] }
      ],
      roof: { type: 'flat', height: 0.35, inset: 0.28, material: 'roof' }
    },
    {
      id: 'machine_shop',
      districts: ['industrial_heavy'],
      weight: 2,
      lot: { frontage: [28, 42], depth: [26, 38], setback: [6, 12] },
      palette: { body: '#989890', accent: '#585850', roof: '#484840', glass: '#8898a8' },
      pieces: [
        { material: 'body', size: [24, 8, 22], offset: [0, 4, 0] },
        { material: 'accent', size: [8, 6, 5], offset: [0, 3, 9] }
      ],
      roof: { type: 'flat', height: 0.45, inset: 0.38, material: 'roof' }
    },
    {
      id: 'welding_shop',
      districts: ['industrial_light', 'industrial_heavy'],
      weight: 2,
      lot: { frontage: [16, 24], depth: [18, 26], setback: [4, 8] },
      palette: { body: '#a8a098', accent: '#484848', roof: '#505048', glass: '#889cb0' },
      pieces: [
        { material: 'body', size: [13, 5.5, 15], offset: [0, 2.75, 0] }
      ],
      roof: { type: 'flat', height: 0.36, inset: 0.28, material: 'roof' }
    },
    {
      id: 'equipment_rental',
      districts: ['industrial_light'],
      weight: 2,
      lot: { frontage: [28, 44], depth: [24, 36], setback: [6, 12] },
      palette: { body: '#b8b0a4', accent: '#f0a828', roof: '#585850', glass: '#8aa0b5' },
      pieces: [
        { material: 'body', size: [22, 6, 18], offset: [0, 3, 0] },
        { material: 'accent', size: [8, 4, 6], offset: [0, 2, 8] }
      ],
      roof: { type: 'flat', height: 0.4, inset: 0.32, material: 'roof' }
    },
    {
      id: 'wholesale_warehouse',
      districts: ['industrial_light', 'industrial_heavy'],
      weight: 2,
      lot: { frontage: [32, 50], depth: [28, 44], setback: [6, 14] },
      palette: { body: '#a8a498', accent: '#686860', roof: '#585850', glass: '#8aa0b5' },
      pieces: [
        { material: 'body', size: [28, 9, 24], offset: [0, 4.5, 0] }
      ],
      roof: { type: 'flat', height: 0.45, inset: 0.38, material: 'roof' }
    },
    {
      id: 'lumber_yard',
      districts: ['industrial_heavy'],
      weight: 2,
      lot: { frontage: [36, 56], depth: [30, 46], setback: [8, 16] },
      palette: { body: '#b8a888', accent: '#7a5838', roof: '#605848', glass: '#8aa0b5' },
      pieces: [
        { material: 'body', size: [30, 7, 24], offset: [0, 3.5, 0] },
        { material: 'accent', size: [12, 5, 8], offset: [0, 2.5, 10] }
      ],
      roof: { type: 'flat', height: 0.42, inset: 0.35, material: 'roof' }
    },
    {
      id: 'salvage_yard',
      districts: ['industrial_heavy'],
      weight: 1,
      lot: { frontage: [40, 60], depth: [32, 50], setback: [8, 16] },
      palette: { body: '#888880', accent: '#585850', roof: '#505048', glass: '#8898a8' },
      pieces: [
        { material: 'body', size: [20, 5, 16], offset: [0, 2.5, 0] }
      ],
      roof: { type: 'flat', height: 0.35, inset: 0.28, material: 'roof' }
    }
  ],
  
  'highrise-pack.json': [
    {
      id: 'residential_tower_modern',
      districts: ['residential_high'],
      weight: 3,
      lot: { frontage: [20, 30], depth: [20, 30], setback: [2, 5] },
      palette: { body: '#b8bcc4', accent: '#5a6878', roof: '#383a42', glass: '#8498b0' },
      pieces: [
        { material: 'body', size: [16, 38, 16], offset: [0, 19, 0] },
        { material: 'accent', size: [16.5, 0.35, 0.7], offset: [0, 10, 7.8] },
        { material: 'accent', size: [16.5, 0.35, 0.7], offset: [0, 19, 7.8] },
        { material: 'accent', size: [16.5, 0.35, 0.7], offset: [0, 28, 7.8] }
      ],
      roof: { type: 'flat', height: 0.6, inset: 0.55, material: 'roof' }
    },
    {
      id: 'residential_tower_glass',
      districts: ['residential_high', 'mixed_main'],
      weight: 2,
      lot: { frontage: [22, 32], depth: [22, 32], setback: [2, 4] },
      palette: { body: '#88a0b8', accent: '#4a6078', roof: '#303238', glass: '#7a98b0' },
      pieces: [
        { material: 'body', size: [18, 44, 18], offset: [0, 22, 0] },
        { material: 'accent', size: [18.5, 0.35, 0.7], offset: [0, 11, 8.8] },
        { material: 'accent', size: [18.5, 0.35, 0.7], offset: [0, 22, 8.8] },
        { material: 'accent', size: [18.5, 0.35, 0.7], offset: [0, 33, 8.8] }
      ],
      roof: { type: 'flat', height: 0.65, inset: 0.6, material: 'roof' }
    },
    {
      id: 'office_tower_glass',
      districts: ['mixed_main', 'commercial_general'],
      weight: 2,
      lot: { frontage: [24, 36], depth: [24, 36], setback: [2, 5] },
      palette: { body: '#8898a8', accent: '#3a4858', roof: '#282a30', glass: '#7a90a8' },
      pieces: [
        { material: 'body', size: [20, 56, 20], offset: [0, 28, 0] },
        { material: 'accent', size: [20.5, 0.4, 0.8], offset: [0, 14, 9.8] },
        { material: 'accent', size: [20.5, 0.4, 0.8], offset: [0, 28, 9.8] },
        { material: 'accent', size: [20.5, 0.4, 0.8], offset: [0, 42, 9.8] }
      ],
      roof: { type: 'flat', height: 0.7, inset: 0.65, material: 'roof' }
    },
    {
      id: 'office_tower_setback',
      districts: ['commercial_general'],
      weight: 1,
      lot: { frontage: [26, 40], depth: [26, 40], setback: [3, 6] },
      palette: { body: '#a8acb4', accent: '#3a4858', roof: '#303238', glass: '#8096b0' },
      pieces: [
        { material: 'body', size: [22, 32, 22], offset: [0, 16, 0] },
        { material: 'body', size: [16, 24, 16], offset: [0, 44, 0] },
        { material: 'accent', size: [22.5, 0.4, 0.8], offset: [0, 16, 10.8] },
        { material: 'accent', size: [16.5, 0.35, 0.7], offset: [0, 38, 7.8] }
      ],
      roof: { type: 'flat', height: 0.65, inset: 0.6, material: 'roof' }
    },
    {
      id: 'hotel_modern',
      districts: ['mixed_main', 'commercial_general'],
      weight: 2,
      lot: { frontage: [24, 36], depth: [24, 36], setback: [3, 6] },
      palette: { body: '#c4c8d0', accent: '#6a7080', roof: '#383a42', glass: '#869ab2' },
      pieces: [
        { material: 'body', size: [20, 44, 20], offset: [0, 22, 0] },
        { material: 'accent', size: [20.5, 0.4, 0.8], offset: [0, 11, 9.8] },
        { material: 'accent', size: [20.5, 0.4, 0.8], offset: [0, 22, 9.8] },
        { material: 'accent', size: [20.5, 0.4, 0.8], offset: [0, 33, 9.8] }
      ],
      roof: { type: 'flat', height: 0.65, inset: 0.6, material: 'roof' }
    },
    {
      id: 'hotel_boutique',
      districts: ['mixed_main'],
      weight: 2,
      lot: { frontage: [20, 30], depth: [20, 30], setback: [2, 5] },
      palette: { body: '#d0ccc4', accent: '#786858', roof: '#484850', glass: '#8aa0b8' },
      pieces: [
        { material: 'body', size: [16, 28, 16], offset: [0, 14, 0] },
        { material: 'accent', size: [16.5, 0.45, 0.9], offset: [0, 7, 7.8] },
        { material: 'accent', size: [16.5, 0.45, 0.9], offset: [0, 14, 7.8] },
        { material: 'accent', size: [16.5, 0.45, 0.9], offset: [0, 21, 7.8] }
      ],
      roof: { type: 'flat', height: 0.55, inset: 0.5, material: 'roof' }
    },
    {
      id: 'condo_tower_slim',
      districts: ['residential_high'],
      weight: 3,
      lot: { frontage: [18, 26], depth: [18, 26], setback: [2, 4] },
      palette: { body: '#bcc0c8', accent: '#6a7888', roof: '#383a42', glass: '#869ab2' },
      pieces: [
        { material: 'body', size: [14, 48, 14], offset: [0, 24, 0] },
        { material: 'accent', size: [14.5, 0.35, 0.7], offset: [0, 12, 6.8] },
        { material: 'accent', size: [14.5, 0.35, 0.7], offset: [0, 24, 6.8] },
        { material: 'accent', size: [14.5, 0.35, 0.7], offset: [0, 36, 6.8] }
      ],
      roof: { type: 'flat', height: 0.55, inset: 0.5, material: 'roof' }
    },
    {
      id: 'apartment_slab',
      districts: ['residential_high'],
      weight: 3,
      lot: { frontage: [32, 48], depth: [16, 24], setback: [2, 4] },
      palette: { body: '#b0b4bc', accent: '#586878', roof: '#383a42', glass: '#8498b0' },
      pieces: [
        { material: 'body', size: [28, 36, 12], offset: [0, 18, 0] },
        { material: 'accent', size: [28.5, 0.35, 0.7], offset: [0, 9, 5.8] },
        { material: 'accent', size: [28.5, 0.35, 0.7], offset: [0, 18, 5.8] },
        { material: 'accent', size: [28.5, 0.35, 0.7], offset: [0, 27, 5.8] }
      ],
      roof: { type: 'flat', height: 0.5, inset: 0.45, material: 'roof' }
    },
    {
      id: 'mixed_use_tower_point',
      districts: ['mixed_main'],
      weight: 2,
      lot: { frontage: [22, 32], depth: [22, 32], setback: [2, 5] },
      palette: { body: '#b4b8c0', accent: '#5a6878', roof: '#383a42', glass: '#8498b0' },
      pieces: [
        { material: 'accent', size: [16, 6, 16], offset: [0, 3, 0] },
        { material: 'body', size: [16, 40, 16], offset: [0, 26, 0] },
        { material: 'accent', size: [16.5, 0.35, 0.7], offset: [0, 16, 7.8] },
        { material: 'accent', size: [16.5, 0.35, 0.7], offset: [0, 26, 7.8] },
        { material: 'accent', size: [16.5, 0.35, 0.7], offset: [0, 36, 7.8] }
      ],
      roof: { type: 'flat', height: 0.6, inset: 0.55, material: 'roof' }
    },
    {
      id: 'landmark_tower',
      districts: ['commercial_general'],
      weight: 1,
      lot: { frontage: [30, 44], depth: [30, 44], setback: [4, 8] },
      palette: { body: '#a0a4ac', accent: '#3a4250', roof: '#282a30', glass: '#7e94ac' },
      pieces: [
        { material: 'body', size: [26, 60, 26], offset: [0, 30, 0] },
        { material: 'accent', size: [26.5, 0.5, 1], offset: [0, 15, 12.8] },
        { material: 'accent', size: [26.5, 0.5, 1], offset: [0, 30, 12.8] },
        { material: 'accent', size: [26.5, 0.5, 1], offset: [0, 45, 12.8] }
      ],
      roof: { type: 'flat', height: 0.8, inset: 0.75, material: 'roof' }
    }
  ]
};

function updateCatalog(filename) {
  const filePath = path.join(CATALOGS_DIR, filename);
  const content = fs.readFileSync(filePath, 'utf-8');
  const catalog = JSON.parse(content);
  
  const newBuildings = NEW_BUILDINGS[filename];
  if (!newBuildings) {
    console.log(`No new buildings for ${filename}`);
    return;
  }
  
  const existingIds = new Set(catalog.entries.map(e => e.id));
  let added = 0;
  
  for (const building of newBuildings) {
    if (!existingIds.has(building.id)) {
      catalog.entries.push(building);
      added++;
    }
  }
  
  fs.writeFileSync(filePath, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`${filename}: Added ${added} new buildings`);
}

function main() {
  for (const filename of Object.keys(NEW_BUILDINGS)) {
    updateCatalog(filename);
  }
}

main();
