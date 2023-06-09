import { Calculator } from 'fqm-execution';
import {
    CalculationOutput,
    DetailedPopulationGroupResult,
    EpisodeResults,
    ExecutionResult,
    PopulationResult,
} from 'fqm-execution/build/types/Calculator';
import {
    Group,
    Measure,
    Population,
    PopulationExpectedValue,
    TestCase,
    Stratification,
    StratificationExpectedValue,
    //PopulationDisplayValue,
} from '@madie/madie-models';
import { Bundle, ValueSet, BundleEntry } from 'fhir/r4';
import * as _ from 'lodash';

import { PopulationType as FqmPopulationType } from 'fqm-execution/build/types/Enums';
import { getPopulationTypesForScoring } from '../util/PopulationsMap';
import { isTestCasePopulationObservation } from '../util/Utils';
import { GroupPopulation } from '@madie/madie-models/dist/TestCase';

export enum ExecutionStatusType {
    NA = 'NA',
    INVALID = 'Invalid',
    PASS = 'pass',
    FAIL = 'fail',
}

export interface StatementResultMap {
    [statementName: string]: number;
}

export interface GroupStatementResultMap {
    [groupId: string]: StatementResultMap;
}

export interface TestCaseGroupStatementResult {
    [testCaseId: string]: GroupStatementResultMap;
}

export interface PopulationEpisodeResult {
    id?: string;
    populationType: FqmPopulationType;
    define: string;
    value: number;
}

export interface ProcessedResultType {
    populations: any;
    observations: any;
}

// TODO consider converting into a context.
// OR a re-usable hook.
//export class CalculationService {

export default async function calculateTestCases(
    measure: Measure,
    testCases: TestCase[],
    measureBundle: Bundle,
    valueSets: ValueSet[],
): Promise<CalculationOutput<any>> {
    const TestCaseBundles = testCases.map((testCase) => {
        return buildPatientBundle(testCase);
    });

    const calculationOutput: CalculationOutput<any> = await calculate(
        measureBundle,
        TestCaseBundles,
        valueSets,
        measure.measurementPeriodStart.toString(),
        measure.measurementPeriodEnd.toString(),
    );

    // set onto window for any environment debug purposes
    // if (localStorage.getItem("madieDebug") || (window as any).madieDebug) {
    //   // eslint-disable-next-line no-console
    //   console.log(_.cloneDeep(calculationOutput?.results));
    // }
    return calculationOutput;
}

// fqm Execution requires each patient to be with unique ID.
// So assigning the testCase ID as patient ID to retrieve calculate multiple testcases
const buildPatientBundle = (testCase: TestCase): Bundle => {
    const testCaseBundle: Bundle = JSON.parse(testCase.json);
    testCaseBundle.entry
        .filter((entry: BundleEntry) => {
            return entry.resource.resourceType === 'Patient';
        })
        .forEach((entry: BundleEntry) => {
            entry.resource.id = testCase.id;
        });
    return testCaseBundle;
};

const calculate = async (
    measureBundle: Bundle,
    patientBundles: Bundle[],
    valueSets: ValueSet[],
    measurementPeriodStart: string,
    measurementPeriodEnd: string,
): Promise<CalculationOutput<any>> => {
    try {
        return await Calculator.calculate(
            measureBundle,
            patientBundles,
            {
                includeClauseResults: false,
                trustMetaProfile: true,
                measurementPeriodStart: measurementPeriodStart,
                measurementPeriodEnd: measurementPeriodEnd,
            },
            valueSets,
        );
    } catch (err) {
        console.error('An error occurred in FQM-Execution', err);
        throw err;
    }
};

const processRawResults = (
    executionResults: ExecutionResult<DetailedPopulationGroupResult>[],
): TestCaseGroupStatementResult => {
    const testCaseResultMap: TestCaseGroupStatementResult = {};
    if (executionResults) {
        for (const tc of executionResults) {
            const testCaseId: string = tc?.patientId;
            const groupResults: DetailedPopulationGroupResult[] = tc?.detailedResults || [];
            testCaseResultMap[testCaseId] = buildGroupResultsMap(groupResults);
        }
    }

    return testCaseResultMap;
};

const buildGroupResultsMap = (groupResults: DetailedPopulationGroupResult[]) => {
    const outputGroupResultsMap: GroupStatementResultMap = {};
    groupResults?.forEach((groupResult) => {
        const groupId = groupResult?.groupId;
        const statementResults = groupResult?.statementResults || [];
        const defineResultMap: StatementResultMap = {};
        for (const statementResult of statementResults) {
            if (statementResult && statementResult.statementName) {
                if (typeof statementResult.raw === 'boolean') {
                    defineResultMap[statementResult.statementName] = statementResult?.raw ? 1 : 0;
                } else if (Array.isArray(statementResult?.raw)) {
                    defineResultMap[statementResult.statementName] = statementResult?.raw?.length || 0;
                } else {
                    defineResultMap[statementResult.statementName] = 0;
                }
            }
        }
        outputGroupResultsMap[groupId] = defineResultMap;
    });
    return outputGroupResultsMap;
};

const getPassingPercentageForTestCases = (testCases: TestCase[]) => {
    const totalTestCases = testCases?.length;
    const passedTests = testCases?.filter((testCase) => testCase.executionStatus === 'pass').length;

    return {
        passPercentage: Math.floor((passedTests / totalTestCases) * 100),
        passFailRatio: passedTests + '/' + totalTestCases,
    };
};

const mapMeasureGroup = (group: Group): GroupPopulation => {
    const calculateEpisodes = 'boolean' === _.lowerCase(group.populationBasis);
    return {
        groupId: group.id,
        scoring: group.scoring,
        populationBasis: group.populationBasis,
        stratificationValues: group.stratifications?.map((stratification: Stratification, index: number) => ({
            name: `Strata-${index + 1} ${_.startCase(stratification.association)}`,
            expected: calculateEpisodes ? false : null,
            actual: calculateEpisodes ? false : null,
            id: stratification.id,
            criteriaReference: '',
        })),
        populationValues: getPopulationTypesForScoring(group)?.map((population: PopulationExpectedValue) => ({
            name: population.name,
            expected: calculateEpisodes ? false : null,
            actual: calculateEpisodes ? false : null,
            id: population.id,
            criteriaReference: population.criteriaReference,
        })),
    };
};

const isValuePass = (actual: any, expected: any, patientBased: boolean) => {
    if (patientBased) {
        return !!actual == !!expected;
    } else {
        const actualVal = _.isNil(actual) ? 0 : _.toNumber(actual);
        const expectedVal = _.isNil(expected) ? 0 : _.toNumber(expected);
        return actualVal == expectedVal;
    }
};

const buildPatientResults = (populationResults: PopulationResult[]) => {
    const results: ProcessedResultType = {
        populations: {},
        observations: {},
    };
    if (!_.isNil(populationResults) && populationResults.length > 0) {
        for (const populationResult of populationResults) {
            if (populationResult.populationType === FqmPopulationType.OBSERV && populationResult.observations) {
                const id = populationResult.criteriaReferenceId;
                results.observations[id] = {
                    ...populationResult,
                    result: true,
                    observations: [...populationResult.observations],
                };
            } else if (populationResult.populationType !== FqmPopulationType.OBSERV) {
                results.populations[populationResult.populationId] = {
                    ...populationResult,
                };
            }
        }
    }
    return results;
};

const buildEpisodeResults = (episodeResults: EpisodeResults[]): ProcessedResultType => {
    const results: ProcessedResultType = {
        populations: {},
        observations: {},
    };
    if (!_.isNil(episodeResults)) {
        for (const episodeResult of episodeResults) {
            if (episodeResult.populationResults && episodeResult.populationResults.length > 0) {
                for (const populationResult of episodeResult.populationResults) {
                    if (populationResult.populationType === FqmPopulationType.OBSERV && populationResult.observations) {
                        const id = populationResult.criteriaReferenceId;
                        if (results.observations[id]) {
                            results.observations[id].observations = _.concat(
                                results.observations[id].observations,
                                populationResult.observations,
                            );
                        } else {
                            results.observations[id] = {
                                ...populationResult,
                                result: true,
                                observations: _.cloneDeep(populationResult.observations),
                            };
                        }
                    } else if (populationResult.populationType !== FqmPopulationType.OBSERV) {
                        const id = populationResult.populationId;
                        if (results.populations[id] && populationResult.result) {
                            results.populations[id].result += 1;
                        } else if (_.isNil(results.populations[id])) {
                            results.populations[id] = {
                                ...populationResult,
                                result: populationResult.result ? 1 : 0,
                            };
                        }
                    }
                }
            }
        }
    }
    return results;
};

const isGroupPass = (groupPopulation: GroupPopulation) => {
    let groupPass = true;

    if (groupPopulation) {
        const patientBased = 'boolean' === _.lowerCase(groupPopulation.populationBasis);
        groupPopulation.populationValues?.every((popVal: PopulationExpectedValue) => {
            const isObs = isTestCasePopulationObservation(popVal);
            groupPass = groupPass && isValuePass(popVal.actual, popVal.expected, isObs ? false : patientBased);
            return groupPass;
        });

        groupPopulation?.stratificationValues?.every((stratVal: StratificationExpectedValue) => {
            groupPass = groupPass && isValuePass(stratVal.actual, stratVal.expected, patientBased);
            return groupPass;
        });
    }

    return groupPass;
};

const processTestCaseResults = (
    testCase: TestCase,
    measureGroups: Group[],
    populationGroupResults: DetailedPopulationGroupResult[],
): TestCase => {
    if (_.isNil(testCase)) {
        return testCase;
    }

    const updatedTestCase = _.cloneDeep(testCase);
    const groupResultsMap = buildGroupResultsMap(populationGroupResults);
    let allGroupsPass = true;
    if (_.isNil(testCase?.groupPopulations)) {
        updatedTestCase.groupPopulations = [];
    }

    // Only perform calculations for provided groups (Can be used to limit results)
    for (const measureGroup of measureGroups) {
        const groupId = measureGroup.id;
        let tcGroupPopulation = updatedTestCase.groupPopulations.find((gp: GroupPopulation) => gp?.groupId === groupId);
        if (_.isNil(tcGroupPopulation)) {
            tcGroupPopulation = mapMeasureGroup(measureGroup);
            updatedTestCase.groupPopulations.push(tcGroupPopulation);
        }

        const populationGroupResult: DetailedPopulationGroupResult = populationGroupResults?.find(
            (popGroupResult) => popGroupResult.groupId === groupId,
        );

        const tcPopTypeCount = {};
        const patientBased = 'boolean' === _.lowerCase(measureGroup.populationBasis);

        const processedResults = patientBased
            ? buildPatientResults(populationGroupResult?.populationResults)
            : buildEpisodeResults(populationGroupResult?.episodeResults);

        tcGroupPopulation?.populationValues.forEach((tcPopVal: PopulationExpectedValue, idx: number) => {
            // Set the actual population value for measure observations
            if (isTestCasePopulationObservation(tcPopVal)) {
                if (patientBased) {
                    tcPopVal.actual = processedResults.observations[tcPopVal.criteriaReference]?.observations?.[0];
                } else {
                    let currentTCObserv = tcPopTypeCount[tcPopVal.name as keyof typeof tcPopTypeCount] ?? 0;
                    const allObsResults = processedResults?.observations[tcPopVal.criteriaReference];
                    if (allObsResults && currentTCObserv < allObsResults.observations?.length) {
                        tcPopVal.actual = allObsResults.observations?.[currentTCObserv];
                    } else {
                        tcPopVal.actual = null;
                    }

                    if (tcPopTypeCount[tcPopVal.name]) {
                        tcPopTypeCount[tcPopVal.name] = tcPopTypeCount[tcPopVal.name] + 1;
                    } else {
                        tcPopTypeCount[tcPopVal.name] = 1;
                    }
                }
            } else {
                // find result
                const measureGroupPopulation: Population = findMeasureGroupPopulation(measureGroup, tcPopVal);
                const result = processedResults?.populations[measureGroupPopulation.id]?.result;
                tcPopVal.actual = _.isNil(result) && !patientBased ? 0 : result;
            }
        });

        tcGroupPopulation?.stratificationValues?.forEach((stratValue: StratificationExpectedValue) => {
            const strataDefinition = measureGroup.stratifications.find(
                (stratification: Stratification) => stratification.id === stratValue.id,
            )?.cqlDefinition;
            stratValue.actual = patientBased
                ? groupResultsMap[groupId]?.[strataDefinition] > 0
                : groupResultsMap[groupId]?.[strataDefinition];
        });

        allGroupsPass = allGroupsPass && isGroupPass(tcGroupPopulation);
    }

    updatedTestCase.executionStatus = allGroupsPass ? ExecutionStatusType.PASS : ExecutionStatusType.FAIL;

    return updatedTestCase;
};

const findMeasureGroupPopulation = (measureGroup: Group, populationValue: PopulationExpectedValue): Population => {
    return measureGroup?.populations?.find(
        (population: Population) =>
            (!_.isNil(populationValue.id) && population.id === populationValue.id) ||
            (_.isNil(populationValue.id) && populationValue.name === population.name),
    );
};
//}

// export default function calculationService(): CalculationService {
//   return new CalculationService();
// }
