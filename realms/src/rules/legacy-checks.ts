import { Ajv } from 'ajv';
import { DomainError } from '../foundation/errors.js';
export type CheckRules={version:1;ruleset:'D20_CHECK_V1';attributeDivisor:number;attributeBaseline:number;proficiencyPerRank:number;natural20:'NORMAL'|'SUCCESS';natural1:'NORMAL'|'FAILURE'};
export type CheckInput={roll:number;attributeScore:number;proficiencyRank:number;situationalModifier:number;difficulty:number};
const checkRules=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['version','ruleset','attributeDivisor','attributeBaseline','proficiencyPerRank','natural20','natural1'],properties:{
  version:{type:'integer',const:1},ruleset:{type:'string',const:'D20_CHECK_V1'},attributeDivisor:{type:'integer',minimum:1,maximum:9999},attributeBaseline:{type:'integer',minimum:0,maximum:9999},proficiencyPerRank:{type:'integer',minimum:0,maximum:100},natural20:{type:'string',enum:['NORMAL','SUCCESS']},natural1:{type:'string',enum:['NORMAL','FAILURE']}
}});
export function validateCheckRules(value:unknown):asserts value is CheckRules {
  if(!checkRules(value))throw new DomainError(400,'INVALID_CHECK_RULES');
}
export function resolveCheck(rules:CheckRules,input:CheckInput) {
  validateCheckRules(rules);
  const {roll,attributeScore,proficiencyRank,situationalModifier,difficulty}=input;
  if(!Number.isInteger(roll)||roll<1||roll>20 || !Number.isInteger(attributeScore)||attributeScore<1||attributeScore>9999 ||
    !Number.isInteger(proficiencyRank)||proficiencyRank<0||proficiencyRank>5 || !Number.isInteger(situationalModifier)||Math.abs(situationalModifier)>1000000 || !Number.isInteger(difficulty)||Math.abs(difficulty)>1000000)
    throw new DomainError(409,'INVALID_CHECK_INPUT');
  const attribute=Math.floor((attributeScore-rules.attributeBaseline)/rules.attributeDivisor),proficiency=proficiencyRank*rules.proficiencyPerRank;
  const total=roll+attribute+proficiency+situationalModifier,margin=total-difficulty;
  const override=roll===20 && rules.natural20==='SUCCESS'?'SUCCESS':roll===1 && rules.natural1==='FAILURE'?'FAILURE':null;
  return {roll,attribute,proficiency,situationalModifier,total,difficulty,margin,override,success:override===null?margin>=0:override==='SUCCESS'};
}

export function checkSuccessChance(rules:CheckRules,input:Omit<CheckInput,'roll'>) {
  let successes=0;
  for(let roll=1;roll<=20;roll++)if(resolveCheck(rules,{...input,roll}).success)successes++;
  return {numerator:successes,denominator:20};
}
