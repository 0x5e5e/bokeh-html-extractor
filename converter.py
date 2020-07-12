import sys
import json
import base64
import math
import numpy as np
import itertools

def read():
    # Read from stdin [encoded array data, shape, dtype] as json
    lines = sys.stdin.readlines()
    return json.loads(lines[0])

def decode(data):
    # Decode base64 encoded __ndarray__
    b64 = base64.b64decode(data['__ndarray__'])
    array = np.fromstring(b64, dtype=data['dtype'])
    if len(data['shape']) > 1:
        array = array.reshape(data['shape'])
    return array

def main():
    # Read from stdin
    node_input = read()

    # Decode into NumPy array
    decoded_data = decode(node_input)

    # Convert to Python list
    decoded_data_list = decoded_data.tolist()

    # Send back to Node.js over stdout
    print(decoded_data_list)

# start process
if __name__ == '__main__':
    main()