import lookupManufacturer from 'flight-recorder-manufacturers/lookup'

const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

/* tslint:disable:max-line-length */
const RE_A = /^A(\w{3})(\w{3,}?)(?:FLIGHT:(\d+)|\:(.+))?$/;
const RE_HFDTE = /^HFDTE(?:DATE:)?(\d{2})(\d{2})(\d{2})(?:,?(\d{2}))?/;
const RE_PLT_HEADER = /^H[FOP]PLT(?:.{0,}?:(.*)|(.*))$/;
const RE_CM2_HEADER = /^H[FOP]CM2(?:.{0,}?:(.*)|(.*))$/; // P is used by some broken Flarms
const RE_GTY_HEADER = /^H[FOP]GTY(?:.{0,}?:(.*)|(.*))$/;
const RE_GID_HEADER = /^H[FOP]GID(?:.{0,}?:(.*)|(.*))$/;
const RE_CID_HEADER = /^H[FOP]CID(?:.{0,}?:(.*)|(.*))$/;
const RE_CCL_HEADER = /^H[FOP]CCL(?:.{0,}?:(.*)|(.*))$/;
const RE_FTY_HEADER = /^H[FOP]FTY(?:.{0,}?:(.*)|(.*))$/;
const RE_RFW_HEADER = /^H[FOP]RFW(?:.{0,}?:(.*)|(.*))$/;
const RE_RHW_HEADER = /^H[FOP]RHW(?:.{0,}?:(.*)|(.*))$/;
const RE_B = /^B(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})([NS])(\d{3})(\d{2})(\d{3})([EW])([AV])(-\d{4}|\d{5})(-\d{4}|\d{5})/;
const RE_K = /^K(\d{2})(\d{2})(\d{2})/;
const RE_IJ = /^[IJ](\d{2})(?:\d{2}\d{2}[A-Z]{3})+/;
const RE_TASK = /^C(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{4})([-\d]{2})(.*)/;
//const RE_TASKPOINT = /^C(\d{2})(\d{2})(\d{3})([NS])(\d{3})(\d{2})(\d{3})([EW])(.*)/;
// see https://github.com/JuanIrache/igc-parser/commit/f698c15c912cf08ff98b7354216b63dab42d1a19
const RE_TASKPOINT = /^C(\d{2})(\d{2})(\d{3,6})([NS])(\d{3})(\d{2})(\d{3,6})([EW])(.*)/;
const RE_LXOZ = /^LLXVOZ/
const RE_LNAVOZN = /^LNAVOZN=(-?\d)/        // captures the index

/* tslint:enable:max-line-length */

export namespace IGCParserNS {
    export interface Options {
        lenient?: boolean;
    }

    export interface IGCFile {
        /** UTC date of the flight in ISO 8601 format */
        date: string;
        numFlight: number | null;

        pilot: string | null;
        copilot: string | null;

        gliderType: string | null;
        registration: string | null;
        callsign: string | null;
        competitionClass: string | null;

        loggerId: string | null;
        loggerManufacturer: string;
        loggerType: string | null;
        firmwareVersion: string | null;
        hardwareVersion: string | null;

        task: Task | null;

        fixes: BRecord[];
        dataRecords: KRecord[];
        ozRecords: OZRecord[];

        security: string | null;

        errors: Error[];
    }

    export interface PartialIGCFile extends Partial<IGCFile> {
        fixes: BRecord[];
        dataRecords: KRecord[];
    }

    export interface ARecord {
        manufacturer: string;
        loggerId: string | null;
        numFlight: number | null;
        additionalData: string | null;
    }

    export interface BRecord {
        /** Unix timestamp of the GPS fix in milliseconds */
        timestamp: number;

        /** UTC time of the GPS fix in ISO 8601 format */
        time: string;

        latitude: number;
        longitude: number;
        valid: boolean;
        pressureAltitude: number | null;
        gpsAltitude: number | null;

        extensions: RecordExtensions;

        fixAccuracy: number | null;

        /** Engine Noise Level from 0.0 to 1.0 */
        enl: number | null;
        /** MOP same basis */        
        mop: number | null;
        /* Current same basis */
        cur: number|null;
    }

    export interface KRecord {
        /** Unix timestamp of the data record in milliseconds */
        timestamp: number;

        /** UTC time of the data record in ISO 8601 format */
        time: string;

        extensions: RecordExtensions;
    }

    export interface OZRecord {
        index: number;
        Style: number;
        R1: number;
        A1: number;
        R2: number;
        A2: number;
        A12: number;
        Line:boolean
        Autonext: boolean;
        Elev?: number;
        Lat: number;
        Lon: number;
    }
    export interface RecordExtensions {
        [code: string]: string;
    }

    export interface RecordExtension {
        code: string;
        start: number;
        length: number;
    }

    export interface Task {
        declarationDate: string;
        declarationTime: string;
        declarationTimestamp: number;

        flightDate: string | null;
        taskNumber: number | null;

        numTurnpoints: number;
        comment: string | null;

        points: TaskPoint[];
    }

    export interface TaskPoint {
        latitude: number;
        longitude: number;
        name: string | null;
    }
}

export class IGCParser {
    private _result: IGCParserNS.PartialIGCFile = {
        numFlight: null,
        pilot: null,
        copilot: null,
        gliderType: null,
        registration: null,
        callsign: null,
        competitionClass: null,
        loggerType: null,
        firmwareVersion: null,
        hardwareVersion: null,
        task: null,
        fixes: [],
        dataRecords: [],
        ozRecords:[],
        security: null,
        errors: [],
    };

    private fixExtensions: IGCParserNS.RecordExtension[] = [];
    private dataExtensions: IGCParserNS.RecordExtension[] = [];

    private lineNumber = 0;
    private prevTimestamp: number | null = null;

    static parse(str: string, options: IGCParserNS.Options = {}): IGCParserNS.IGCFile {
        const parser = new IGCParser();

        const errors = [];
        for (const line of str.split('\n')) {
            try {
                parser.processLine(line.trim());
            } catch (error) {
                if (options.lenient) {
                    errors.push(error);
                } else {
                    throw error;
                }
            }
        }

        const result = parser.result;
        result.errors = errors as Error[];

        return result;
    }

    get result(): IGCParserNS.IGCFile {
        if (!this._result.loggerManufacturer) {
            throw new Error(`Missing A record`);
        }

        if (!this._result.date) {
            throw new Error(`Missing HFDTE record`);
        }

        return this._result as IGCParserNS.IGCFile;
    }

    private processLine(line: string) {
        this.lineNumber += 1;

        const recordType = line[0];

        if (recordType === 'B') {
            const fix = this.parseBRecord(line);

            this.prevTimestamp = fix.timestamp;

            this._result.fixes.push(fix);

        } else if (recordType === 'K') {
            const data = this.parseKRecord(line);

            this.prevTimestamp = data.timestamp;

            this._result.dataRecords.push(data);

        } else if (recordType === 'L') {
            const data = this.parseLRecord(line);
            if (data) {
                this._result.ozRecords?.push(data)
            }

        } else if (recordType === 'H') {
            this.processHeader(line);

        } else if (recordType === 'C') {
            this.processTaskLine(line);

        } else if (recordType === 'A') {
            const record = this.parseARecord(line);

            this._result.loggerId = record.loggerId;
            this._result.loggerManufacturer = record.manufacturer;

            if (record.numFlight !== null) {
                this._result.numFlight = record.numFlight;
            }

        } else if (recordType === 'I') {
            this.fixExtensions = this.parseIJRecord(line);

        } else if (recordType === 'J') {
            this.dataExtensions = this.parseIJRecord(line);

        } else if (recordType === 'G') {
            this._result.security = (this._result.security || '') + line.slice(1);
        }
    }

    private processHeader(line: string) {
        const headerType = line.slice(2, 5);
        if (headerType === 'DTE') {
            const record = this.parseDateHeader(line);

            this._result.date = record.date;

            if (record.numFlight !== null) {
                this._result.numFlight = record.numFlight;
            }

        } else if (headerType === 'PLT') {
            this._result.pilot = this.parsePilot(line);
        } else if (headerType === 'CM2') {
            this._result.copilot = this.parseCopilot(line);
        } else if (headerType === 'GTY') {
            this._result.gliderType = this.parseGliderType(line);
        } else if (headerType === 'GID') {
            this._result.registration = this.parseRegistration(line);
        } else if (headerType === 'CID') {
            this._result.callsign = this.parseCallsign(line);
        } else if (headerType === 'CCL') {
            this._result.competitionClass = this.parseCompetitionClass(line);
        } else if (headerType === 'FTY') {
            this._result.loggerType = this.parseLoggerType(line);
        } else if (headerType === 'RFW') {
            this._result.firmwareVersion = this.parseFirmwareVersion(line);
        } else if (headerType === 'RHW') {
            this._result.hardwareVersion = this.parseHardwareVersion(line);
        }
    }

    private parseARecord(line: string): IGCParserNS.ARecord {
        let match = line.match(RE_A);
        if (match) {
            const manufacturer = lookupManufacturer(match[1]);
            const loggerId = match[2];
            const numFlight = match[3] ? parseInt(match[3], 10) : null;
            const additionalData = match[4] || null;
            return { manufacturer, loggerId, numFlight, additionalData };
        }

        match = line.match(/^A(\w{3})(.+)?$/);
        if (match) {
            const manufacturer = lookupManufacturer(match[1]);
            const additionalData = match[2] ? match[2].trim() : null;
            return { manufacturer, loggerId: null, numFlight: null, additionalData };
        }

        throw new Error(`Invalid A record at line ${this.lineNumber}: ${line}`);
    }

    private parseDateHeader(line: string): { date: string, numFlight: number | null } {
        const match = line.match(RE_HFDTE);
        if (!match) {
            throw new Error(`Invalid DTE header at line ${this.lineNumber}: ${line}`);
        }

        const lastCentury = match[3][0] === '8' || match[3][0] === '9';
        const date = `${lastCentury ? '19' : '20'}${match[3]}-${match[2]}-${match[1]}`;

        const numFlight = match[4] ? parseInt(match[4], 10) : null;

        return { date, numFlight };
    }

    private parseTextHeader(headerType: string, regex: RegExp, line: string, underscoreReplacement = ' '): string {
        const match = line.match(regex);
        if (!match) {
            throw new Error(`Invalid ${headerType} header at line ${this.lineNumber}: ${line}`);
        }

        return (match[1] || match[2] || '').replace(/_/g, underscoreReplacement).trim();
    }

    private parsePilot(line: string): string {
        return this.parseTextHeader('PLT', RE_PLT_HEADER, line);
    }

    private parseCopilot(line: string): string {
        return this.parseTextHeader('CM2', RE_CM2_HEADER, line);
    }

    private parseGliderType(line: string): string {
        return this.parseTextHeader('GTY', RE_GTY_HEADER, line);
    }

    private parseRegistration(line: string): string {
        return this.parseTextHeader('GID', RE_GID_HEADER, line, '-');
    }

    private parseCallsign(line: string): string {
        return this.parseTextHeader('GTY', RE_CID_HEADER, line);
    }

    private parseCompetitionClass(line: string): string {
        return this.parseTextHeader('GID', RE_CCL_HEADER, line);
    }

    private parseLoggerType(line: string): string {
        return this.parseTextHeader('FTY', RE_FTY_HEADER, line);
    }

    private parseFirmwareVersion(line: string): string {
        return this.parseTextHeader('RFW', RE_RFW_HEADER, line);
    }

    private parseHardwareVersion(line: string): string {
        return this.parseTextHeader('RHW', RE_RHW_HEADER, line);
    }

    private processTaskLine(line: string) {
        if (!this._result.task) {
            this._result.task = this.parseTask(line);
        } else {
            this._result.task.points.push(this.parseTaskPoint(line));
        }
    }

    private parseTask(line: string): IGCParserNS.Task {
        const match = line.match(RE_TASK);
        if (!match) {
            throw new Error(`Invalid task declaration at line ${this.lineNumber}: ${line}`);
        }

        let lastCentury = match[3][0] === '8' || match[3][0] === '9';
        const declarationDate = `${lastCentury ? '19' : '20'}${match[3]}-${match[2]}-${match[1]}`;
        const declarationTime = `${match[4]}:${match[5]}:${match[6]}`;
        const declarationTimestamp = Date.parse(`${declarationDate}T${declarationTime}Z`);

        let flightDate = null;
        if (match[7] !== '00' || match[8] !== '00' || match[9] !== '00') {
            lastCentury = match[9][0] === '8' || match[9][0] === '9';
            flightDate = `${lastCentury ? '19' : '20'}${match[9]}-${match[8]}-${match[7]}`;
        }

        const taskNumber = (match[10] !== '0000') ? parseInt(match[10], 10) : null;
        const numTurnpoints = parseInt(match[11], 10);
        const comment = match[12] || null;

        return {
            declarationDate,
            declarationTime,
            declarationTimestamp,
            flightDate,
            taskNumber,
            numTurnpoints,
            comment,
            points: [],
        };
    }

    private parseTaskPoint(line: string): IGCParserNS.TaskPoint {
        const match = line.match(RE_TASKPOINT);
        if (!match) {
            throw new Error(`Invalid task point declaration at line ${this.lineNumber}: ${line}`);
        }

        const latitude = IGCParser.parseLatitude(match[1], match[2], match[3], match[4]);
        const longitude = IGCParser.parseLongitude(match[5], match[6], match[7], match[8]);
        const name = match[9] || null;

        return { latitude, longitude, name };
    }

    private parseBRecord(line: string): IGCParserNS.BRecord {
        if (!this._result.date) {
            throw new Error(`Missing HFDTE record before first B record`);
        }

        const match = line.match(RE_B);
        if (!match) {
            throw new Error(`Invalid B record at line ${this.lineNumber}: ${line}`);
        }

        const time = `${match[1]}:${match[2]}:${match[3]}`;
        const timestamp = this.calcTimestamp(time);

        const latitude = IGCParser.parseLatitude(match[4], match[5], match[6], match[7]);
        const longitude = IGCParser.parseLongitude(match[8], match[9], match[10], match[11]);

        const valid = match[12] === 'A';

        const pressureAltitude = match[13] === '00000' ? null : parseInt(match[13], 10);
        const gpsAltitude = match[14] === '00000' ? null : parseInt(match[14], 10);

        const extensions: IGCParserNS.RecordExtensions = {};
        if (this.fixExtensions) {
            for (const { code, start, length } of this.fixExtensions) {
                extensions[code] = line.slice(start, start + length);       
                // if (code==='MOP') {
                //     Log(`Time ${time} MOP from ${start} to ${start+length} is ${extensions[code]}`)
                // }
            }
        }

        let enl = null;
        if (extensions['ENL']) {
            const enlLength = this.fixExtensions.filter(it => it.code === 'ENL')[0].length;
            const enlMax = Math.pow(10, enlLength);
            enl = parseInt(extensions['ENL'], 10) / enlMax;
        }

        let mop = null;
        if (extensions['MOP']) {
            const mopLength = this.fixExtensions.filter(it => it.code === 'MOP')[0].length;
            const mopMax = Math.pow(10, mopLength);
            mop = parseInt(extensions['MOP'], 10) / mopMax;
            //Log(`Time ${time}, MoP ${mop}`)
        }
        let cur = null;
        if (extensions['CUR']) {
            const curLength = this.fixExtensions.filter(it => it.code === 'CUR')[0].length;
            const curMax = Math.pow(10, curLength);
            cur = parseInt(extensions['CUR'], 10) / curMax;
        }
        
        const fixAccuracy = extensions['FXA'] ? parseInt(extensions['FXA'], 10) : null;
        return {
            timestamp,
            time,
            latitude,
            longitude,
            valid,
            pressureAltitude,
            gpsAltitude,
            extensions,
            enl,
            mop,
            cur,
            fixAccuracy,
        };
    }

    private parseKRecord(line: string): IGCParserNS.KRecord {
        if (!this._result.date) {
            throw new Error(`Missing HFDTE record before first K record`);
        }

        if (!this.dataExtensions) {
            throw new Error(`Missing J record before first K record`);
        }

        const match = line.match(RE_K);
        if (!match) {
            throw new Error(`Invalid K record at line ${this.lineNumber}: ${line}`);
        }
        const time = `${match[1]}:${match[2]}:${match[3]}`;
        const timestamp = this.calcTimestamp(time);

        const extensions: IGCParserNS.RecordExtensions = {};
        if (this.dataExtensions) {
            for (const { code, start, length } of this.dataExtensions) {
                extensions[code] = line.slice(start, start + length);
            }
        }

        return { timestamp, time, extensions };
    }

    private parseIJRecord(line: string): IGCParserNS.RecordExtension[] {
        const match = line.match(RE_IJ);
        if (!match) {
            throw new Error(`Invalid ${line[0]} record at line ${this.lineNumber}: ${line}`);
        }

        const num = parseInt(match[1], 10);
        if (line.length < 3 + num * 7) {
            throw new Error(`Invalid ${line[0]} record at line ${this.lineNumber}: ${line}`);
        }

        const extensions = new Array<IGCParserNS.RecordExtension>(num);

        for (let i = 0; i < num; i++) {
            const offset = 3 + i * 7;
            const start = parseInt(line.slice(offset, offset + 2), 10) - 1; // the Record Extensions values are 1 based, the later slice is zero-based
            const end = parseInt(line.slice(offset + 2, offset + 4), 10) -1;
            const length = end - start + 1;
            const code = line.slice(offset + 4, offset + 7);

            extensions[i] = { start, length, code };

        }
        return extensions;
    }

    private parseLRecord(line: string) {
        let oz:IGCParserNS.OZRecord = {
            index: 0,
            Style: 0,
            R1: 0,
            A1: 0,
            R2: 0,
            A2: 0,
            A12: 0,
            Line:false,
            Autonext: false,
            Lat: 0,
            Lon: 0,
        }
        const match = line.match(RE_LXOZ);
        if (match) {

            const parts = line.split(',')
            parts.forEach(part=>{
                const data=part.split('=');
                switch (data[0]) {
                    case 'LLXVOZ' : {
                        oz.index=parseInt(data[1])
                        break;
                    }
                    case 'Style' :{
                        oz.Style = parseInt(data[1])
                        break;
                    }
                    case 'R1' : {
                        oz.R1 = IGCParser.parseDistance(data[1]) 
                        break;
                    }
                    case 'R2' : {
                        oz.R2 = IGCParser.parseDistance(data[1]) 
                        break;
                    }
                    case 'A1' : {
                        oz.A1 = parseFloat(data[1])
                        break;
                    }                
                    case 'A2' : {
                        oz.A2 = parseFloat(data[1])
                        break;
                    }                
                    case 'A12' : {
                        oz.A12 = parseFloat(data[1])
                        break;
                    }     
                    case 'Line' :{
                        oz.Line = data[1]==='1'
                        break
                    }
                    case 'Autonext' :{
                        oz.Autonext = data[1]==='1'
                        break;
                    }
                    case 'Lat':{
                        oz.Lat=IGCParser.parseLatitude(
                            data[1].substring(0,2),
                            data[1].substring(2,2),
                            data[1].substring(5,3),
                            data[1].slice(-1)
                        )
                        break;                    
                    }
                    case 'Lon' :{
                        oz.Lon=IGCParser.parseLongitude(
                            data[1].substring(0,3),
                            data[1].substring(3,2),
                            data[1].substring(6,3),
                            data[1].slice(-1)
                        )
                        break;
                    }
                    case 'Elev':{
                        oz.Elev = parseInt(data[1].slice(0,-1))   // this assumes always in m
                        break;
                    }
                    default: {
                        //throw new Error(`Invalid LLXVOZ record at line ${this.lineNumber}: ${line}`);
                        //ignore unknown entries
                        break;
                    }
                }
            })
            return oz        
        }
        // now try the Oudie version..
        const match2 = line.match(RE_LNAVOZN)
        if (match2) {   // index will be in Group 1
            const index = parseInt(match2[1])
            console.log(`LNAVOZN: line ${line} has match `, match2 )

            // have we already got this index?
            let oz1 = this._result.ozRecords?.find(r=>r.index===index)
            oz1 = oz1 ? oz1 : oz        // make a new one if necessary
            oz1.index = index;

            const parts = line.split(',')
            parts.forEach(part=>{
                const data=part.split('=');
                switch (data[0]) {
                    case 'Style' :{
                        oz1.Style = parseInt(data[1])
                        break;
                    }
                    case 'R1' : {                        
                        oz1.R1 = IGCParser.parseDistance(data[1])   
                        break;
                    }
                    case 'R2' : {
                        oz1.R2 = IGCParser.parseDistance(data[1])    // this assumes always in m
                        break;
                    }
                    case 'A1' : {
                        oz1.A1 = parseFloat(data[1])
                        break;
                    }                
                    case 'A2' : {
                        oz1.A2 = parseFloat(data[1])
                        break;
                    }                
                    case 'A12' : {
                        oz1.A12 = parseFloat(data[1])
                        break;
                    }     
                    case 'Line' :{
                        oz1.Line = data[1]==='1'
                        break
                    }
                    case 'Autonext' :{
                        oz1.Autonext = data[1]==='1'
                        break;
                    }
                    case 'Lat':{
                        oz1.Lat=IGCParser.parseLatitude(
                            data[1].substring(0,2),
                            data[1].substring(2,2),
                            data[1].substring(5,3),
                            data[1].slice(-1)
                        )
                        break;                    
                    }
                    case 'Lon' :{
                        oz1.Lon=IGCParser.parseLongitude(
                            data[1].substring(0,3),
                            data[1].substring(3,2),
                            data[1].substring(6,3),
                            data[1].slice(-1)
                        )
                        break;
                    }
                    case 'Elev':{
                        oz1.Elev = parseInt(data[1].slice(0,-1))   // this assumes always in m
                        break;
                    }
                    default: {
                        //throw new Error(`Invalid LNAVOZN record at line ${this.lineNumber}: ${line}`);
                        //ignore unknown entries
                        break;
                    }
                }
            })
            //console.log(`LNAVOZN returns `, oz1)
            return oz1
        }

    }

    private static parseDistance(dist:string):number {
        //console.log(`parseDistance from ${dist}, km is ${dist.substring(dist.length-2)==='km'}, value is ${dist.slice(0,-2)}`)
        return dist.substring(dist.length-2)==='km' ?
            parseFloat(dist.slice(0,-2)) * 1000 // convert to m
            :
            parseFloat(dist.slice(0,-1))
        }
    
    private static parseLatitude(dd: string, mm: string, mmm: string, ns: string): number {
        const degrees = parseInt(dd, 10) + parseFloat(`${mm}.${mmm}`) / 60;
        return (ns === 'S') ? -degrees : degrees;
    }

    private static parseLongitude(ddd: string, mm: string, mmm: string, ew: string): number {
        const degrees = parseInt(ddd, 10) + parseFloat(`${mm}.${mmm}`) / 60;
        return (ew === 'W') ? -degrees : degrees;
    }

    /**
     * Figures out a Unix timestamp in milliseconds based on the
     * date header value, the time field in the current record and
     * the previous timestamp.
     */
    private calcTimestamp(time: string): number {
        let timestamp = Date.parse(`${this._result.date}T${time}Z`);

        // allow timestamps one hour before the previous timestamp,
        // otherwise we assume the next day is meant
        while (this.prevTimestamp && timestamp < this.prevTimestamp - ONE_HOUR) {
            timestamp += ONE_DAY;
        }

        return timestamp;
    }
}
