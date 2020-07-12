# Setup Guide

## Environment
Download and install latest LTS version of Node.js (https://nodejs.org/en/download/) if you don't already have it.

Install npm packages required by this project (`npm install` in root dir)

## Data Setup
This can be changed by modifying the run parameters in index.js, but by default the script converts files from a `dp_input` folder in the root dir and outputs to a `output` folder also in the root dir.

Download the required DP 2.x files to your `dp_input` folder - the structure of the processed / working buckets (`gecko-working` and `gecko-processed` is what the script expects, note that whether the data is in a `deliverable` does not matter as the script supports both cases)

To download only the files needed (dataprocessor settings, bokeh HTML files, annotations files, summary stats, etc.) without downloading all the run CSV's, use this command as a template:

`gsutil -m rsync -r -x  "^(?:(?!portal^.html^|^_settings^|graph^.html^|summary^|annotations^|^.xlsx^|binned^_ut^.csv^|binned^_coating^.csv^|binned^_laser^.csv).)*$" gs://gecko-processed .`

## Running the script
Run `node index.js` in the root directory to run the script.

To print out console logs:
`node index.js > log_output.txt`

Logs can be found in the `/logs` subdirectory