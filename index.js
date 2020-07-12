const fs = require('fs');
const fs_extra = require('fs-extra');
const path = require('path');
const _ = require('lodash');

function nthIndex(str, pattern, n) {
  var L = str.length, i = -1;
  while (n-- && i++ < L) {
    i = str.indexOf(pattern, i);
    if (i < 0) break;
  }
  return i;
}

function arrayMin(arr) {
  var len = arr.length, min = Infinity;
  while (len--) {
    if (arr[len] < min) {
      min = arr[len];
    }
  }
  return min;
}

function arrayMax(arr) {
  var len = arr.length, max = -Infinity;
  while (len--) {
    if (arr[len] > max) {
      max = arr[len];
    }
  }
  return max;
}

/**
 * Run Parameters
 */
const INPUT_PATH = './dp_input';
const OUTPUT_PATH = './output';

/**
 * Basic column name mapper
 */
const mapper = {
  'x': 'x_bin',
  'y': 'y_bin',
  'best_value': 'thickness',
  'thickness': 'thickness',
  'image': 'image',
  'customer_tube': 'customer_x',
  'height': 'customer_y',
  'customer_x': 'customer_x',
  'customer_y': 'customer_y',
  'best_value_color': 'color',
  'wall_name': 'wall_name',
  'x_bin': 'x_bin',
  'y_bin': 'y_bin',
  'color': 'color',
  'plot_x': 'plot_x',
  'plot_y': 'plot_y',
  'angle': 'angle',
  'radius': 'radius',
};
const wantedColumns = Object.keys(mapper);

/**
 * Spawn a python process to convert ndarrays (numpy arrays)
 * @param {*} data - node data
 * @param {*} key - node key (column name)
 * @param {*} path - path of this node in the stack
 */
const pythonBroker = (data, key, path) => {
  return new Promise((resolve, reject) => {
    try {
      let spawn = require('child_process').spawn;
      let python_process = spawn('python', ['./converter.py']);
      let dataString = '';

      python_process.stdout.on('data', (data) => {
        dataString += data.toString();
      });

      python_process.stdout.on('end', () => {
        let dataList = eval(dataString);
        resolve({ "key": key, "value": dataList, "path": path });
      });

      python_process.stdin.write(JSON.stringify(data), (err) => {
        python_process.stdin.end();
      });
    } catch (err) {
      reject();
    }
  });
};

/**
 * Recursively traverse JS object tree looking for plot data
 * @param {*} obj - node to process
 * @param {*} stack - position in processing stack
 * @param {*} processingTasks - reference to collection of tasks to reduce over
 */
function processDataTree(obj, stack, processingTasks) {
  for (let property in obj) {
    let node = obj[property];
    if (!node) {
      continue;
    }
    if (obj.hasOwnProperty(property)) {
      if (property === 'text') {
        processingTasks.push(new Promise((resolve, reject) => {
          resolve({ "key": property, "value": node, "path": stack });
        }));
      } else {
        if (wantedColumns.includes(property)) {
          //console.log("Found property: " + property + ", Position in Stack: " + stack);
          // handle multiple types of object / list data -> convert to list
          if (!Array.isArray(node)) {
            // if not an array, it's either an __ndarray__ or junk (height when customer_y exists, for example)
            if ('__ndarray__' in node) {
              processingTasks.push(pythonBroker(node, property, stack));
            } else {
              // junk node, let's break out
              break;
            }
          } else {
            processingTasks.push(new Promise((resolve, reject) => {
              resolve({ "key": property, "value": node, "path": stack });
            }));
          }
        } else if (property === 'code') {
          // Look for bin size data
          const regex = /size\s=\sparseFloat\(([\s\S]*?)\)\;/g;
          const matches = node.match(regex);
          if (matches) {
            const cleanMatches = matches.map(m => m.replace("size = parseFloat(", "").replace(");", ""));
            processingTasks.push(new Promise((resolve, reject) => {
              resolve({ "key": "binSizes", "value": cleanMatches, "path": stack });
            }));
          }
        } else if (property === 'attributes' && typeof obj[property] == 'object' && obj[property]['plot'] === null && obj[property]['text'] && obj[property]['text'].length > 0) {
          processingTasks.push(new Promise((resolve, reject) => {
            resolve({ "key": "plotTitle", "value": obj[property]['text'], "path": stack });
          }));
        }
        if (typeof obj[property] == "object" && !('__ndarray__' in obj[property])) {
          processDataTree(obj[property], stack + '.' + property, processingTasks);
        }
      }
    }
  }
}

/**
 * Process a node's data
 * @param {*} key - column name (from html), unconverted
 * @param {*} path - path of this node in the stack
 * @param {*} value - data value of node object
 * @param {*} data - aggregate data object to map to
 */
function processNode(key, path, value, data) {

  if (key === 'text') {
    return;
  }

  if (key == 'plotTitle') {
    data['title'] = value;
    return;
  }

  // Handle edge case of nodes that are just a list of column names
  const convertedKey = mapper[key];
  if (!convertedKey) {
    throw `converted_key_error: ${key}`;
  }

  // Grab reference ID from node path
  const pathParts = path.split('.');
  if (!pathParts || pathParts.length <= 0) throw `invalid_path_error: ${path}`;

  const indexOfReferences = pathParts.indexOf('references');
  if (indexOfReferences === -1) throw `invalid_path_error: ${path}`;

  const referenceID = pathParts[indexOfReferences + 1];
  if (!referenceID) throw `reference_id_error: ${path}`;

  // If reference ID doesn't yet exist in final data, initialize it
  if (!data[referenceID]) {
    data[referenceID] = {};
  }

  // Insert data for this reference ID into data object
  data[referenceID][convertedKey] = value;
}

/**
 * Attempt to reverse engineer colors from color-thickness columns
 * Original python code from DP 2.x
 */
const RED_COLOR_THRESHOLD = 50;
const GREEN_COLOR_THRESHOLD = 370;
const ALPHA = 0.6;

function parseColorValue(hexColor) {
  const rgbValue = hexColor.replace('#', '');
  const rValue = parseInt(rgbValue.slice(0, 2), 16);
  const gValue = parseInt(rgbValue.slice(2, 4), 16);
  const colorValue = (gValue < 255) ? gValue : 512 - rValue;
  if (colorValue >= 0 && colorValue < 512) {
    return colorValue;
  }
  return -1;
}

function getThreshold(colorData, thicknessData) {
  const colorValues = colorData.map(c => parseColorValue(c));
  const sampleValues = [];
  for (let x = 0; x < colorValues.length; x++) {
    const colorValue = colorValues[x];
    if (colorValue !== -1) {
      const thicknessValue = thicknessData[x];
      sampleValues.push({color: colorValue, thickness: thicknessValue});
    }
  }
  const sortedSampleValues = sampleValues.sort((a, b) => {
    let thicknessA = a.thickness;
    let thicknessB = b.thickness;
    if (thicknessA < thicknessB) {
      return -1;
    }
    if (thicknessA > thicknessB) {
      return 1;
    }
    return 0;
  });

  if (sortedSampleValues.length < 3) {
    return null;
  }

  const outliers = [sortedSampleValues[0], sortedSampleValues[sortedSampleValues.length - 1]];

  if (outliers.length !== 2) {
    return null;
  } else {
    const thicknessDifference = outliers[0].thickness - outliers[1].thickness;
    const colorDifference = outliers[0].color - outliers[1].color;
    const slope = colorDifference / thicknessDifference;
    const yIntercept = outliers[0].color - slope * outliers[0].thickness;

    const greenThreshold = (GREEN_COLOR_THRESHOLD - yIntercept) / slope;
    const redThreshold = greenThreshold - ((GREEN_COLOR_THRESHOLD - RED_COLOR_THRESHOLD) / slope);
    const precision = 6; // four decimal places for bin thickness thresholds

    return [parseFloat(redThreshold.toFixed(precision)), parseFloat(greenThreshold.toFixed(precision))];
  }
}

/**
 * Process a bokeh HTML file
 * @param {*} sourceFilePath - path to this file
 * @param {*} sourceFileName - name of this file
 * @param {*} inspectionDir - inspection slug
 * @Param {*} hasAnnotations - whether this inspection has plot_annotations associated exceptionText
 * @return - returns data object to write to file
 */
function processFile(sourceFilePath, sourceFileName, red_thickness_threshold, green_thickness_threshold, units, x_bin_size, y_bin_size, plot_rotation) {

  return new Promise((resolve, reject) => {

    try {

      const data = fs.readFileSync(sourceFilePath, "utf8");
      if (!data) {
        return reject('Error: no data in file');
      }

      // Create processingTasks queue of pythonBroker child processes
      let processingTasks = [];

      const dataString = data;

      // Handle Excel only HTML placeholder files
      if (sourceFilePath.includes('excel') || dataString.includes('excel_download')) {
        return reject('Excel:' + sourceFileName);
      }

      const firstSelector = "Bokeh.safely(function() {";
      const secondSelector = "Bokeh.embed.embed_items(docs_json, render_items);";

      const loc1 = dataString.lastIndexOf(firstSelector);
      const loc2 = dataString.lastIndexOf(secondSelector);

      let jsString = dataString.substring(loc1 + firstSelector.length, loc2 - 1);

      if (jsString.length > 5000) {  // jsString should have grabbed the relevant javascript judging by the length of the substring (lol), let's eval it and parse through

        eval(jsString);

        const sourceCopy = docs_json;
        const keys = Object.keys(sourceCopy);
        const firstElement = sourceCopy[keys[0]];

        processDataTree(firstElement, '', processingTasks);

      } else { // Our first-pass logic isn't working due to the format of the bokeh html, try another approach

        const newFirstSelector = '<script type=\"application/json\"'
        const newSecondSelector = '<script type=\"text/javascript\">';

        const newloc0 = dataString.indexOf(newFirstSelector) + 5;
        const newloc1 = dataString.substring(newloc0, newloc0 + 100).indexOf('>') + newloc0 + 1;

        const newloc2 = dataString.lastIndexOf(newSecondSelector);
        const newloc3 = newloc1 + dataString.substring(newloc1, newloc2).indexOf('</script>');

        jsString = dataString.substring(newloc1, newloc3);

        eval('var injection = (' + jsString + ');'); // interpret string as object literal and assign it to a variable.  hacky but it works

        processDataTree(injection, '', processingTasks);
      }

      let rawData = {};
      Promise.all(processingTasks).then((result) => {

        let binSizes = [x_bin_size, y_bin_size];

        if (!result || result.length <= 0) {
          return reject('Error: no results from python processing');
        }

        result.forEach((r) => {
          // Process this node
          try {
            if (r.key === 'binSizes') {
              if (x_bin_size === null || y_bin_size === null) {
                binSizes = r.value;
              }
            } else {
              processNode(r.key, r.path, r.value, rawData);
            }
          } catch (e) {
            return reject('Error: error processing node');
          }
        });

        if (!rawData) {
          return reject('Error');
        }

        const plotTitle = rawData['title'];
        delete rawData['title'];

        const referenceKeys = Object.keys(rawData);

        const fileName = sourceFilePath.split("/").slice(-1)[0];
        let plotTypes = [];
        if (fileName.includes("ut_")) {
          plotTypes.push("ut");
        } else if (fileName.includes("coating_")) {
          plotTypes.push("coating");
        } else if (fileName.includes("laser_")) {
          plotTypes.push("laser");
        } else {
          plotTypes.push("ut");
        }

        // Default plot configuration
        let dataOutput = {
          'plot_types': plotTypes,
          'has_subplots': false,
          'plots': []
        };
        let rawColumns = [];

        // Extract raw columns
        referenceKeys.forEach((referenceID) => {
          rawColumns = Object.keys(rawData[referenceID]);
        });

        // Cone plot (old and new format) classification
        if (rawColumns.includes('radius') && rawColumns.includes('angle')) {
          dataOutput['plot_types'].push('cone_v1');
        }

        // For each reference section, add to plots array
        referenceKeys.forEach((referenceID) => {

          let plotDataByReferenceID = rawData[referenceID];

          // If this reference section is junk, continue to next referenceID
          if (Object.keys(plotDataByReferenceID).length < 6) {
            return;
          }

          // Check if it's a cone plot
          if (plotDataByReferenceID['plot_x'] && plotDataByReferenceID['plot_x'][0]) {
            let firstPlotX = plotDataByReferenceID['plot_x'][0];
            if (firstPlotX && firstPlotX.length && firstPlotX.length === 4) {
              dataOutput['plot_types'].push('cone_v2');
            }
          }

          // Column modifications for old cone plot format
          if (dataOutput['plot_types'].includes('cone_v1')) {

            const rad = plotDataByReferenceID['radius'];
            const ang = plotDataByReferenceID['angle'];
            const plot_x = plotDataByReferenceID['x_bin'];
            const plot_y = plotDataByReferenceID['y_bin'];

            plotDataByReferenceID['x_bin'] = rad;
            plotDataByReferenceID['customer_x'] = rad;
            plotDataByReferenceID['y_bin'] = ang;
            plotDataByReferenceID['customer_y'] = ang;

            delete plotDataByReferenceID['radius'];
            delete plotDataByReferenceID['angle'];

            plotDataByReferenceID['plot_x'] = plot_x;
            plotDataByReferenceID['plot_y'] = plot_y;
          }

          let thresholds = {};
          const thicknessData = (plotDataByReferenceID['thickness']) ? plotDataByReferenceID['thickness'] : plotDataByReferenceID['best_value'];

          if (!red_thickness_threshold && !green_thickness_threshold) {
            const colorData = (plotDataByReferenceID['color']) ? plotDataByReferenceID['color'] : plotDataByReferenceID['best_value_color'];

            if (colorData && thicknessData) {
              const derivedThresholds = getThreshold(colorData, thicknessData);
              if (derivedThresholds === null || !derivedThresholds || !derivedThresholds[0] || !derivedThresholds[1]) {
                // if we can't reverse engineer these thresholds at all, let's mark it as such
                thresholds = null;
              } else {
                thresholds['start_of_red'] = derivedThresholds[0];
                thresholds['start_of_green'] = derivedThresholds[1];
              }
            } else {
              thresholds = null;
            }
          } else {
            thresholds['start_of_red'] = red_thickness_threshold;
            thresholds['start_of_green'] = green_thickness_threshold;
          }

          delete plotDataByReferenceID['wall_name']; // un-needed column

          // Compute Stats
          let thickness_min = null;
          let thickness_avg = null;
          let thickness_max = null;

          if (thicknessData) {
            thickness_min = arrayMin(thicknessData);
            thickness_avg = thicknessData.reduce((a, b) => a + b) / thicknessData.length;
            thickness_max = arrayMax(thicknessData);
          }

          let binSizesFloats = (binSizes) ? binSizes.map((bs) => parseFloat(bs)) : [];
          let uniquePlotTypes = [...new Set(dataOutput['plot_types'])];
          let plotData = {
            'title': plotTitle,
            'thresholds': thresholds,
            'thickness_min': thickness_min,
            'thickness_avg': thickness_avg,
            'thickness_max': thickness_max,
            'plot_rotation': plot_rotation,
            'units': units,
            'source_file': sourceFileName,
            'plot_types': uniquePlotTypes,
            'bin_sizes': binSizesFloats,
            'data': plotDataByReferenceID
          };
          dataOutput.plots.push(plotData);
        });

        // Verify structure of data
        let filteredDataPlots = [];
        if (dataOutput && dataOutput.plots && dataOutput.plots.length > 0) {
          filteredDataPlots = dataOutput.plots.filter((p) => {
            return (p.data && Object.keys(p.data).length > 4);
          });
          if (filteredDataPlots.length < 0) {
            return reject('Error: filteredDataPlots.length is less than zero');
          }
        } else {
          return reject('Error: dataOutput plots does not exist');
        }

        dataOutput.plots = filteredDataPlots;
        dataOutput['has_subplots'] = (dataOutput.plots.length > 1);

        return resolve(dataOutput);
      }).catch((err) => {
        console.error(err);
        reject('Error: ' + err);
      });
    } catch (err) {
      reject('Error: ' + err);
    }
  });
}

function createLogFile(name) {
  return fs.createWriteStream(`logs/${name}.log`, { flags: 'a' });
}

function logEvent(text, file) {
  fs.appendFileSync(`logs/${file}.log`, text + '\n');
}

async function main() {

  const getDirs = srcPath => fs.readdirSync(srcPath).filter(file => fs.statSync(path.join(srcPath, file)).isDirectory());
  const inspectionDirs = getDirs(INPUT_PATH);

  /**
   * Path validation
   */
  const INSPECTION_SLUG_REGEX = /^[0-9]{8}-[0-9a-fA-F]{6}$/;
  let validInspectionDirs = inspectionDirs.filter(slug => INSPECTION_SLUG_REGEX.test(slug));

  /**
   * Catch script failures
   */
  const errorCatcher = (exception, inspectionDir, fileName) => {
    let exceptionText = exception.toString();
    if (exceptionText.startsWith('Excel')) {
      // Log excel found
      console.log(`Excel found: ${inspectionDir}`);
      logEvent(inspectionDir, 'excel');

      // Join plotObjects from individual HTML files.  most attributes should be the same
      const combinedDataOutput = {
        'data_version': 'v1.0',
        'plots': [
          {
            "plot_types": ['excel_only'],
            "source_file": exceptionText.replace('Excel:', '')
          }
        ]
      };

      const combinedStatsOutput = {
        'num_data_readings': null
      };

      const outputPathStats = `${OUTPUT_PATH}/${inspectionDir}/inspection_stats.json`;

      fs_extra.outputFile(outputPathStats, JSON.stringify(combinedStatsOutput), (err) => {
        if (err) {
          console.error(err);
        }
      });

      // Determine output path
      const outputPath = `${OUTPUT_PATH}/${inspectionDir}/binned_plot_data.json`;

      // Write to output
      fs_extra.outputFile(outputPath, JSON.stringify(combinedDataOutput), (err) => {
        if (err) {
          console.error(err);
        }
      });
    } else if (exceptionText.startsWith('Error:')) {
      console.log(`Unable to process: ${inspectionDir} due to error: ${exceptionText}`)
      logEvent(inspectionDir, 'failed');
    }
  };

  /**
   * Iterate through all inspection directories and run processing tasks
   */
  validInspectionDirs.forEach((inspectionDir) => {

    let processingQueue = [];

    // Collect list of all eligible files (paths) in this inspectionDir, including files in /deliveraable
    const eligibleFiles = ['_portal.html', '_graph.html', 'binned_ut.csv', 'binned_coating.csv', 'binned_laser.csv', 'plot_annotations', 'dataprocessor_settings.json', 'summary_report.json', '.xlsx'];
    const inspectionRootPath = `${INPUT_PATH}/${inspectionDir}/`;
    const deliverablePath = `${inspectionRootPath}deliverable`;
    const databasePath = `${inspectionRootPath}database`;

    let files = fs.readdirSync(inspectionRootPath).map((f) => [`${inspectionRootPath}/${f}`, f]);

    // Add /deliverable files
    if (fs.existsSync(deliverablePath)) {
      files = files.concat(fs.readdirSync(deliverablePath).map((f) => [`${deliverablePath}/${f}`, f]));
    }

    // Add /database files
    if (fs.existsSync(databasePath)) {
      files = files.concat(fs.readdirSync(databasePath).map((f) => [`${databasePath}/${f}`, f]));
    }

    // Filter out non-matches
    files = files.filter(f => {
      let foundMatch = false;
      for (let matcher of eligibleFiles) {
        if (f[1].includes(matcher)) {
          foundMatch = true;
          break;
        }
      }
      return foundMatch;
    });

    // Flag inspections with multiple _portal html files - MULTIPLE HTML FILE EDGE CASE
    let multipleFiles = false;
    const portal_files = files.filter(f => f[1].includes('_portal.html'));
    const portal_graph_files = files.filter(f => f[1].includes('_graph.html'));

    if (portal_files.length > 1) {
      logEvent(inspectionDir, 'multiple');
      multipleFiles = true;
    } else if (portal_files.length <= 0 && portal_graph_files.length <= 0) {
      logEvent(inspectionDir, 'missing');
      return;
    }

    // Stats
    let isLaser = false;
    const coating_files = files.filter(f => f[1].includes('coating'));
    const laser_files = files.filter(f => f[1].includes('laser'));
    if (coating_files && coating_files.length > 1) {
      logEvent(inspectionDir, 'coating');
    } else if (laser_files && laser_files.length > 1) {
      isLaser = true;
      logEvent(inspectionDir, 'laser');
    }

    // Look for anomalies / edge cases and flag
    let hasAnnotations = false;
    for (let file of files) {
      // Log if annotations are present
      if (file[1] === 'plot_annotations.json') {
        logEvent(inspectionDir, 'annotations');
        hasAnnotations = true;
        break;
      }
    }

    // Obtain the color threshold if it exists in dataprocessor_settings.  Else, defer to processFile to reverse engineer it.
    let red_thickness_threshold = null;
    let green_thickness_threshold = null;
    let unit_of_measurement = "ft-in";
    let x_bin_size = null;
    let y_bin_size = null;
    let plot_rotation = null;

    const dataprocessor_settings_files = files.filter(f => f[1].includes('dataprocessor_settings.json'));
    if (dataprocessor_settings_files && dataprocessor_settings_files.length === 1) {
      const settings_data = fs.readFileSync(dataprocessor_settings_files[0][0], "utf8");
      try {
        const settings = JSON.parse(settings_data); // TODO: catch invalid format
        red_thickness_threshold = settings['red_thickness_threshold'];
        green_thickness_threshold = settings['green_thickness_threshold'];
        unit_of_measurement = settings['units'];
        x_bin_size = settings['x_bin_size'];
        y_bin_size = settings['y_bin_size'];
        plot_rotation = ('plot_rotation' in settings) ? settings['plot_rotation'] : null;
      } catch(e) {
        // ...
      }
    }

    // Parse stats
    let number_of_readings = null;
    const summary_report_files = files.filter(f => f[1].includes('summary_report.json'));
    if (summary_report_files && summary_report_files.length === 1) {
      const summary_report_data = fs.readFileSync(summary_report_files[0][0], "utf8");
      try {
        const summary_report = JSON.parse(summary_report_data);
        number_of_readings = summary_report['Number of data points'];
      } catch(e) {
        // ...
      }
    }

    // These inspections have either incorrect or missing units in the legacy data
    let petropower_inspections = ['20181024-13da31', '20180308-6addc8'];
    let clp_inspections = ['20180410-f86f85', '20181105-23a07b', '20180123-152fc9'];

    if (petropower_inspections.includes(inspectionDir) || clp_inspections.includes(inspectionDir)) {
      unit_of_measurement = "m-mm";
    }

    // Copy over needed files to /legacy
    for (let file of files) {
      fs_extra.copy(file[0], `${OUTPUT_PATH}/${inspectionDir}/legacy/${file[1]}`, err => {
        if (err) return console.error(err);
      });
    }

    // Generated binned_plot_data.json from bokeh HTML and data files
    let portalFiles = files.filter(f => f[1].includes('_portal.html'));
    let graphFiles = files.filter(f => f[1].includes('graph.html'));

    let filesToProcess = [];
    if (portalFiles.length <= 0) {
      if (graphFiles.length <= 0) {
        return console.log("FATAL ERROR");
      } else {
        filesToProcess = graphFiles;
      }
    } else {
      filesToProcess = portalFiles;
    }

    for (let index = 0; index < filesToProcess.length; index++) {
      const file = filesToProcess[index];
      const rtt = (index === 0) ? red_thickness_threshold : null;
      const gtt = (index === 0) ? green_thickness_threshold : null;
      const processTask = [processFile(file[0], file[1], rtt, gtt, unit_of_measurement, x_bin_size, y_bin_size, plot_rotation), inspectionDir];
      console.log("Detected: " + file[1]);
      processingQueue.push(processTask);
    }

    /**
     * Run all processing tasks
     */
    let plotObjects = [];
    const processingResults = Promise.all(

      processingQueue.map(
        p => p[0].then((dataObject) => {
          if (dataObject) {
            plotObjects.push(dataObject);
          }
        }).catch(
          e => errorCatcher(e, inspectionDir, p)
        )
      )

    ).then((v) => {

      console.log(`Successfully processed: ${inspectionDir}`);

      if (plotObjects && plotObjects.length > 0) {

        let inspection_types = ["legacy"];
        if (hasAnnotations) {
          inspection_types.push("legacy_annotations");
        }
        if(plotObjects.length > 1) {
          inspection_types.push("multiple_plots");
        }

        if (plotObjects.some((p) => p.plots.length > 1)) { // subplots
          inspection_types.push("subplots");
        }

        // Join plotObjects from individual HTML files.  most attributes should be the same
        const combinedPlots = [].concat(...plotObjects.map((p) => p['plots']));
        let sortedPlots = null;
        try {
          sortedPlots = combinedPlots.sort((a, b) => {
            // Sort plots by length of binned data columns (this usually works, but sometimes is not what's desired)
            const sizeA = (a[0]) ? a[0].data['x_bin'].length : a.data['x_bin'].length;
            const sizeB = (b[0]) ? b[0].data['x_bin'].length : b.data['x_bin'].length;
            return sizeB - sizeA;
          })
        } catch(e) {
          console.log(e);
          sortedPlots = combinedPlots;
        }
        if (sortedPlots === null) {
          console.error("SORTED PLOTS NULL");
        }
        const combinedDataOutput = {
          'inspection_types': inspection_types,
          'data_version': 'v1.0',
          'plots': sortedPlots
        };

        const combinedStatsOutput = {
          'num_data_readings': number_of_readings
        };

        const outputPathStats = `${OUTPUT_PATH}/${inspectionDir}/inspection_stats.json`;

        fs_extra.outputFile(outputPathStats, JSON.stringify(combinedStatsOutput), (err) => {
          if (err) {
            console.error(err);
          }
        });

        // Determine output path
        const outputPath = `${OUTPUT_PATH}/${inspectionDir}/binned_plot_data.json`;

        // Write to output
        fs_extra.outputFile(outputPath, JSON.stringify(combinedDataOutput), (err) => {
          if (err) {
            console.error(err);
          }
        });
      }
    });
  });
}

main();
