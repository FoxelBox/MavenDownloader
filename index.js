'use strict';

const fs = require('fs');
const Promise = require('bluebird');
const rp = require('request-promise');
const request = require('request');
const xmlParse = Promise.promisify(require('xml2js').parseString);

const config = require('./config');

function _prepareVersionStr (v) {
	return v.replace(/-SNAPSHOT$/, '').split('.');
}

function compareVersions (v1, v2) {
	const v1parts = _prepareVersionStr(v1), v2parts = _prepareVersionStr(v2);
	const maxLen = Math.max(v1parts.length, v2parts.length);
	let part1, part2;
	for (let i = 0; i < maxLen; i++) {
		part1 = parseInt(v1parts[i], 10) || 0;
		part2 = parseInt(v2parts[i], 10) || 0;
		if (part1 < part2) {
			return false;
		} else if(part1 > part2) {
			return true;
		}
	}
	return false;
}

// https://maven.doridian.net/repository/maven-snapshots/net/md-5/bungeecord-bootstrap/maven-metadata.xml
// https://maven.doridian.net/repository/maven-snapshots/net/md-5/bungeecord-api/1.10-SNAPSHOT/maven-metadata.xml

function main () {
	let mvnPkg = process.argv[2];
	const dest = process.argv[3];

	if (!mvnPkg || !dest) {
		throw new Error('mvnget PACKAGE DEST');
	}

	if (config.aliases[mvnPkg]) {
		mvnPkg = config.aliases[mvnPkg];
	} else if(mvnPkg.indexOf(':') < 0) {
		mvnPkg = config.defaultGroup + ':' + mvnPkg;
	}

	let url = config.repo + mvnPkg.replace(/[:.]/g, '/');
	const artifactId = mvnPkg.replace(/^.*:/, '');

	return rp(`${url}/maven-metadata.xml`)
	.then(xmlParse)
	.then(data => {
		return Promise.reduce(data.metadata.versioning[0].versions[0].version, (latestVersion, version) => {
			if (!latestVersion || compareVersions(version, latestVersion)) {
				return version;
			} else {
				return latestVersion;
			}
		}, null);
	})
	.then(latestVersion => {
		if (!latestVersion) {
			throw new Error('No version found');
		}

		url += `/${latestVersion}`;

		return rp(`${url}/maven-metadata.xml`);
	})
	.then(xmlParse)
	.then(data => {
		const snapshots = data.metadata.versioning[0].snapshotVersions[0].snapshotVersion;
		const snapshot = snapshots.find(snapshot => {
			return (snapshot.extension[0] === 'jar' && !snapshot.classifier);
		});
		if (!snapshot) {
			throw new Error('No binary snapshot found');
		}
		return snapshot.value[0];
	})
	.then(snapshot => {
		return new Promise((resolve, reject) => {
			request.get(`${url}/${artifactId}-${snapshot}.jar`)
			.on('error', reject)
			.pipe(fs.createWriteStream(dest))
			.on('finish', resolve);
		});
	});
}

main().then(() => console.log('OK'));