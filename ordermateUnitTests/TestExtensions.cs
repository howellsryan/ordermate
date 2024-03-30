namespace ordermateUnitTests;

public abstract class TestExtensions
{
    public static void DoesNotThrowException<T>(Action expressionUnderTest, string exceptionMessage = "Expected exception was thrown by target of invocation.") where T : Exception
    {
        try
        {
            expressionUnderTest();
        }
        catch (T)
        {
            Assert.Fail(exceptionMessage);
        }
        catch (Exception)
        {
            Assert.IsTrue(true);
        }
 
        Assert.IsTrue(true);
    }
}