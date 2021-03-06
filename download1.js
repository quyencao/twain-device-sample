const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');

process.env.tmp_directory = '/home/quyencm/Desktop/device-nodejs-mqtt/tmp'
process.env.directory = '/home/quyencm/Desktop/device-nodejs-mqtt/tmp'
process.env.filename = 'model.zip'
process.env.url = 'https://qclibs.s3.amazonaws.com/samples/sources.zip'


const file_path = path.resolve(process.env.tmp_directory, process.env.filename);
const target_path = process.env.directory;

async function download() {
    const url = process.env.url;
    const writer = fs.createWriteStream(file_path);

    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve)
        writer.on('error', reject)
    });
}

download()
    .then(() => {
        const zip = new AdmZip(file_path);
        zip.extractAllTo(target_path, true);
    })
    .catch(error => console.log(error))