const fs = require('fs');
const path = require('path');
const axios = require('axios');
const unzip = require('unzip');

const file_name = process.env.filename;
const target_path = process.env.directory;
const url = process.env.url;

async function download(target) {
    return new Promise(async (resolve, reject) => {
      const { url, out, name } = target;
  
      const request = {
        url,
        responseType: 'stream'
      };
  
      try {
        const response = await axios(request);
        let output;
  
        if (url.endsWith('.zip')) {
            output = unzip.Extract({path: out});
        } else {
            const file = path.resolve(out, name);
            output = fs.createWriteStream(file);
        }
  
        const stream = response.data
            .pipe(output)
            .on('finish', resolve)
            .on('error', reject);
      } catch (err) {
        reject(err);
      }
    });
};

download({
    url: url,
    name: file_name,
    out: target_path
})
.then(() => {
    console.log('DOWNLOAD DONE!!!');
})
.catch(err => {
    console.log('DOWNLOAD FAIL');
})