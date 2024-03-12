using Dapper;
using ordermateAPI.DAL.Interfaces;
using ordermateAPI.DAL.Models;
using ordermateAPI.DAL.Scripts;

namespace ordermateAPI.DAL.Repositories;

public class OrderRepository : IOrderRepository
{
    private readonly IDbContext _dbContext;

    public OrderRepository(IDbContext dbContext)
    {
        _dbContext = dbContext;
    }
    
    public async Task<OrderModel?> Get(string orderNumber)
    {
        using var connection = _dbContext.CreateConnection();
        
        OrderModel? order = await connection.QuerySingleOrDefaultAsync<OrderModel>(OrderScripts.GetByOrderNumber, new { orderNumber });
        return order;
    }
    
    public async Task<OrderModel?> Get(int orderId)
    {
        using var connection = _dbContext.CreateConnection();
        
        OrderModel? order = await connection.QuerySingleOrDefaultAsync<OrderModel>(OrderScripts.Get, new { orderId });
        return order;
    }
    
    public async Task<IEnumerable<OrderModel>> GetByStoreId(int storeId)
    {
        using var connection = _dbContext.CreateConnection();
        
        IEnumerable<OrderModel> orders = await connection.QueryAsync<OrderModel>(OrderScripts.GetByStoreId, new { storeId });
        return orders;
    }

    public async Task<int> Create(string email, int storeId)
    {
        var dateTimeNow = DateTime.UtcNow;
        var orderNumber = Guid.NewGuid().ToString().ToUpper();
        
        using var connection = _dbContext.CreateConnection();

        return await connection.ExecuteAsync(OrderScripts.CreateOrder, new { storeId, orderNumber, email, dateTimeNow });
    }

    public async Task UpdateOrderTotalValue(int orderId, decimal totalValue)
    {
        using var connection = _dbContext.CreateConnection();
        await connection.ExecuteAsync(OrderScripts.UpdateOrderTotalValue, new { orderId, totalValue });
    }
}