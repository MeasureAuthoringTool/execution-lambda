import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { CalculationOutput } from 'fqm-execution/build/types/Calculator';
import { Measure, TestCase } from '@madie/madie-models';
import { Bundle, ValueSet } from 'fhir/r4';
import calculateTestCases from './api/CalculationService';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger();
/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 *
 */

export const lambdaHandler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
    logger.info('Entering lambdaHandler...');
    console.log('Remaining time: ', context.getRemainingTimeInMillis());
    console.log('Function name: ', context.functionName);
    let body;
    const statusCode = 200;

    const headers = {
        'Content-Type': 'application/json',
    };
    try {
        //gets the body from request
        body = event.body;
        const input = JSON.parse(body);
        const measure: Measure = input.measure;
        logger.info('measure id = ' + measure?.id);
        const testCases: TestCase[] = input.testCases;
        const measureBundle: Bundle = input.measureBundle;
        const valueSets: ValueSet[] = input.valueSets;
        const calculationResult: CalculationOutput<any> = await calculateTestCases(
            measure,
            testCases,
            measureBundle,
            valueSets,
        );

        console.log('calculationResult = ' + JSON.stringify(calculationResult));

        body = JSON.stringify(calculationResult);

        return {
            statusCode,
            body,
            headers,
        };
    } catch (err) {
        console.log(err);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'error!!',
            }),
        };
    }
};
